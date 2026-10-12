import path from 'path'
import os from 'os'
import fs from 'fs'
import readline from 'readline'
import { execSync } from 'child_process'
import {
  fetchSessions,
  fetchSources,
  apiRequest,
  fetchAllActivities,
  printActivity,
  hasJulesFinishedWork,
  openUrlInBrowser,
  isRateLimitError,
  handlePollingError,
  readAndFormatLocalFile,
  expandAtFilepaths,
  loadSessionState,
  saveSessionState,
  renderMarkdown,
  log
} from '../common.js'
import { createSession } from './create.js'

export async function repl (sessionId, options = {}) {
  let hasPulledForWork = false
  let targetSessionId = sessionId

  if (!targetSessionId) {
    try {
      const sessions = await fetchSessions()
      if (sessions.length === 0) {
        console.error('\x1b[31m❌ Error: No sessions found for REPL.\x1b[0m')
        process.exit(1)
      }
      targetSessionId = sessions[0].name || sessions[0].id
      console.log(`\x1b[90mNo session ID provided. Defaulting to latest: ${targetSessionId}\x1b[0m`)
    } catch (err) {
      console.error(`\x1b[31m❌ Error fetching latest session: ${err.message}\x1b[0m`)
      process.exit(1)
    }
  }

  const fullSessionId = targetSessionId.startsWith('sessions/') ? targetSessionId : `sessions/${targetSessionId}`
  const shortSessionId = fullSessionId.replace(/^sessions\//, '')

  const sessionState = loadSessionState(fullSessionId)
  let basePromptLabel = sessionState.name || shortSessionId

  if (options.name) {
    basePromptLabel = options.name
    sessionState.name = options.name
    saveSessionState(fullSessionId, sessionState)
  } else if (!sessionState.name) {
    try {
      const sessionInfo = await apiRequest(fullSessionId, 'GET', null, true)
      let source = sessionInfo.sourceContext || sessionInfo.source || sessionInfo.sourceId
      if (source) {
        if (source.startsWith('sources/github/')) {
          source = source.replace(/^sources\/github\//, '')
        } else if (source.startsWith('sources/')) {
          source = source.replace(/^sources\//, '')
        }
        basePromptLabel = `${source}:${shortSessionId}`
      }
    } catch (err) {
      log(`Failed to fetch session info for prompt source label: ${err.message}`)
    }
  }

  const promptColors = {
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    red: '\x1b[31m',
    white: '\x1b[37m',
    reset: '\x1b[0m',
    none: '\x1b[0m',
    default: '\x1b[32m'
  }

  let promptColorCode = promptColors[sessionState.color] || '\x1b[32m'

  console.log(`\x1b[36mJules REPL started for session:\x1b[0m ${fullSessionId}`)
  console.log('\x1b[90mType your message and press Enter. Press Ctrl+C to exit.\x1b[0m\n')

  function saveQueue (sessionId, queue) {
    sessionState.queue = queue
    saveSessionState(sessionId, sessionState)
  }

  let isBusy = false
  const messageQueue = sessionState.queue

  function getPromptString () {
    const queueSuffix = messageQueue.length > 0 ? ` [${messageQueue.length}]` : ''
    return `${promptColorCode}${basePromptLabel}${queueSuffix} > \x1b[0m`
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPromptString()
  })

  function updatePrompt () {
    rl.setPrompt(getPromptString())
  }

  rl.prompt()

  let lastSeenActivityIndex = -1
  let lastState = null
  let lastUpdateTime = null

  async function flushQueue () {
    if (messageQueue.length > 0 && !isBusy) {
      const combinedPayload = messageQueue.join('\n\n---\n\n')
      messageQueue.length = 0
      saveQueue(fullSessionId, messageQueue)
      updatePrompt()
      console.log('\n\x1b[36m📤 Sending queued message(s) to Jules...\x1b[0m')
      isBusy = true
      try {
        await apiRequest(`${fullSessionId}:sendMessage`, 'POST', { prompt: combinedPayload })
        console.log('\x1b[90m(Message sent... Agent is thinking...)\x1b[0m')
      } catch (err) {
        console.error(`\x1b[31mError sending queued messages: ${err.message}\x1b[0m`)
        isBusy = false
      }
    }
  }

  const basePollInterval = process.env.JULES_POLL_INTERVAL ? parseInt(process.env.JULES_POLL_INTERVAL, 10) : 3000
  let currentPollInterval = basePollInterval

  async function poll () {
    try {
      const session = await apiRequest(fullSessionId, 'GET', null, true)
      if (session.state !== lastState) {
        process.stdout.write(`\n\x1b[33m[${new Date().toLocaleTimeString()}] State: ${session.state}\x1b[0m\n`)
        lastState = session.state
        if (session.state === 'AWAITING_USER_INPUT' || session.state === 'AWAITING_USER_FEEDBACK' || session.state === 'COMPLETED' || session.state === 'FAILED' || session.state === 'CANCELLED') {
          isBusy = false
        } else if (session.state === 'IN_PROGRESS' || session.state === 'ACTIVE') {
          isBusy = true
        }
        rl.prompt(true)
      }

      if (session.updateTime !== lastUpdateTime) {
        const activities = await fetchAllActivities(fullSessionId)

        if (lastSeenActivityIndex === -1 && !options.history) {
          lastSeenActivityIndex = activities.length - 1
        } else if (activities.length > lastSeenActivityIndex + 1) {
          for (let i = lastSeenActivityIndex + 1; i < activities.length; i++) {
            try {
              printActivity(i, activities[i], fullSessionId, options)
            } catch (err) {
              console.error(`\x1b[31mError in REPL background loop: ${err.message}\x1b[0m`)
            }
          }
          lastSeenActivityIndex = activities.length - 1
          rl.prompt(true)
        }
        lastUpdateTime = session.updateTime

        if (options.gitPull && !hasPulledForWork && hasJulesFinishedWork(activities, session)) {
          hasPulledForWork = true
          try {
            console.error('\x1b[36mJules is done with work. Running \'git pull\'...\x1b[0m')
            const output = execSync('git pull', { encoding: 'utf8' })
            console.error(output)
          } catch (err) {
            console.error(`\x1b[31m❌ Error running 'git pull': ${err.message}\x1b[0m`)
          }
        }
      }

      if (session.state === 'AWAITING_USER_INPUT' || session.state === 'AWAITING_USER_FEEDBACK' || session.state === 'COMPLETED') {
        isBusy = false
        await flushQueue()
      }
      currentPollInterval = basePollInterval
    } catch (err) {
      if (isRateLimitError(err)) {
        currentPollInterval = process.env.JULES_POLL_INTERVAL ? basePollInterval : Math.min(currentPollInterval * 2, 30000)
      }
      handlePollingError(err, 'REPL background loop')
      rl.prompt(true)
    }

    tailTimeout = setTimeout(poll, currentPollInterval)
  }

  let tailTimeout = setTimeout(poll, currentPollInterval)

  rl.on('line', async (line) => {
    const text = line.trim()
    if (!text) {
      rl.prompt()
      return
    }

    if (text === '/web' || text.startsWith('/web')) {
      const cleanId = fullSessionId.replace(/^sessions\//, '')
      const webUrl = `https://jules.google.com/session/${cleanId}`
      console.log(`\x1b[36m🌐 Opening session in browser:\x1b[0m ${webUrl}\n`)
      openUrlInBrowser(webUrl)
      rl.prompt()
      return
    }

    if (text === '/clear' || text.startsWith('/clear')) {
      console.clear()
      rl.prompt()
      return
    }

    if (text === '/diff' || text.startsWith('/diff')) {
      const cleanId = fullSessionId.replace(/^sessions\//, '')
      const patchPath = path.join(os.tmpdir(), `jules-${cleanId}.patch`)

      let patchContent = ''
      if (fs.existsSync(patchPath)) {
        patchContent = fs.readFileSync(patchPath, 'utf8')
      } else {
        try {
          const activities = await fetchAllActivities(fullSessionId)
          for (let i = activities.length - 1; i >= 0; i--) {
            const act = activities[i]
            if (act.artifacts && Array.isArray(act.artifacts)) {
              for (const art of act.artifacts) {
                if (art.changeSet && art.changeSet.gitPatch && art.changeSet.gitPatch.unidiffPatch) {
                  patchContent = art.changeSet.gitPatch.unidiffPatch
                  fs.writeFileSync(patchPath, patchContent, 'utf8')
                  break
                }
              }
            }
            if (patchContent) break
          }
        } catch (err) {
          log(`Failed to fetch activities for /diff: ${err.message}`)
        }
      }

      if (!patchContent) {
        console.log('\x1b[90mNo git patch artifacts found for this session.\x1b[0m\n')
      } else {
        console.log(`\n\x1b[36m📄 Latest Patch Artifact (${patchPath}):\x1b[0m\n`)
        console.log(renderMarkdown(`\`\`\`diff\n${patchContent}\n\`\`\``))
        console.log(`\x1b[90m💡 Apply to repository:\x1b[0m git apply ${patchPath}\n`)
      }
      rl.prompt()
      return
    }

    if (text.startsWith('/help')) {
      console.log('\n\x1b[1mAvailable REPL Commands:\x1b[0m')
      console.log('  \x1b[32m/upload <filepath>\x1b[0m   Attach and send local text file content')
      console.log('  \x1b[32m/approve\x1b[0m           Approve the generated plan')
      console.log('  \x1b[32m/diff\x1b[0m              View and review latest git patch for the session')
      console.log('  \x1b[32m/rename <name>\x1b[0m       Set a custom display name/label for the REPL prompt')
      console.log('  \x1b[32m/color <color>\x1b[0m      Change prompt color (green, cyan, blue, yellow, magenta, red, white, default)')
      console.log('  \x1b[32m/queue\x1b[0m              List currently queued messages')
      console.log('  \x1b[32m/edit\x1b[0m               Edit currently queued messages in $EDITOR')
      console.log('  \x1b[32m/flush\x1b[0m              Flush and send queued message(s) immediately')
      console.log('  \x1b[32m/clear\x1b[0m              Clear terminal screen')
      console.log('  \x1b[32m/web\x1b[0m                Open session URL in web browser')
      console.log('  \x1b[32m/help\x1b[0m               Display this help message')
      console.log('  \x1b[32m@<filepath>\x1b[0m          Inline syntax to attach file content in prompt\n')
      rl.prompt()
      return
    }

    if (text.startsWith('/color')) {
      const parts = text.split(/\s+/).filter(Boolean)
      const colorArg = parts[1] ? parts[1].toLowerCase() : ''

      const colors = {
        green: '\x1b[32m',
        cyan: '\x1b[36m',
        blue: '\x1b[34m',
        yellow: '\x1b[33m',
        magenta: '\x1b[35m',
        red: '\x1b[31m',
        white: '\x1b[37m',
        reset: '\x1b[0m',
        none: '\x1b[0m',
        default: '\x1b[32m'
      }

      if (!colorArg || !colors[colorArg]) {
        console.error('\x1b[31m❌ Error: Please specify a valid color: green, cyan, blue, yellow, magenta, red, white, default, reset.\x1b[0m')
        rl.prompt()
        return
      }

      promptColorCode = colors[colorArg]
      sessionState.color = colorArg
      saveSessionState(fullSessionId, sessionState)
      updatePrompt()
      console.error(`\x1b[32m✔ REPL prompt color set to ${colorArg}.\x1b[0m`)
      rl.prompt()
      return
    }

    if (text === '/edit') {
      const editor = process.env.EDITOR
      if (!editor) {
        console.error('\x1b[31m❌ Error: Cannot use /edit because `$EDITOR` environment variable is not defined.\x1b[0m')
        console.error('\x1b[90mPlease set `$EDITOR` in your environment (e.g. export EDITOR=vim) to enable editing queued messages in your terminal.\x1b[0m')
        rl.prompt()
        return
      }

      const tmpFile = path.join(os.tmpdir(), `jules-queue-${Date.now()}.md`)
      try {
        const initialContent = messageQueue.join('\n\n---\n\n')
        fs.writeFileSync(tmpFile, initialContent, 'utf8')

        rl.pause()
        execSync(`${editor} "${tmpFile}"`, { stdio: 'inherit' })
        rl.resume()

        const editedContent = fs.readFileSync(tmpFile, 'utf8').trim()
        messageQueue.length = 0

        if (editedContent) {
          const parts = editedContent.split(/\n\s*---\s*\n/).map(s => s.trim()).filter(Boolean)
          messageQueue.push(...parts)
          saveQueue(fullSessionId, messageQueue)
          console.error(`\x1b[32m✔ Queue updated via editor (${messageQueue.length} message(s)).\x1b[0m`)
        } else {
          saveQueue(fullSessionId, messageQueue)
          console.error('\x1b[32m✔ File saved empty. Queue cleared.\x1b[0m')
        }
        updatePrompt()
      } catch (err) {
        console.error(`\x1b[31m❌ Error editing queue in $EDITOR: ${err.message}\x1b[0m`)
      } finally {
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile) } catch (e) {}
      }
      rl.prompt()
      return
    }

    if (text === '/queue') {
      if (messageQueue.length === 0) {
        console.log('\x1b[90mNo queued messages.\x1b[0m')
      } else {
        console.log(`\n\x1b[1mQueued Messages (${messageQueue.length}):\x1b[0m`)
        messageQueue.forEach((msg, i) => {
          console.log(`\x1b[36m${i + 1}.\x1b[0m ${msg}`)
        })
        console.log('')
      }
      rl.prompt()
      return
    }

    if (text.startsWith('/rename')) {
      const newName = text.slice(7).trim()
      if (!newName) {
        console.error('\x1b[31m❌ Error: /rename requires a <name> argument.\x1b[0m')
        rl.prompt()
        return
      }
      basePromptLabel = newName
      sessionState.name = newName
      saveSessionState(fullSessionId, sessionState)
      updatePrompt()
      console.log(`\x1b[32m✔ REPL prompt renamed to: ${newName}\x1b[0m`)
      rl.prompt()
      return
    }

    if (text === '/flush' || text === '/now' || text.startsWith('/flush') || text.startsWith('/now')) {
      if (messageQueue.length === 0) {
        console.error('\x1b[31m❌ Error: No queued messages to flush.\x1b[0m')
        rl.prompt()
        return
      }
      const combinedPayload = messageQueue.join('\n\n---\n\n')
      messageQueue.length = 0
      saveQueue(fullSessionId, messageQueue)
      updatePrompt()
      isBusy = true
      try {
        await apiRequest(`${fullSessionId}:sendMessage`, 'POST', { prompt: combinedPayload })
        console.log('\x1b[90m(Messages flushed and sent immediately... Agent is thinking...)\x1b[0m')
        clearTimeout(tailTimeout)
        tailTimeout = setTimeout(async () => {
          await poll()
        }, Math.min(2000, basePollInterval))
      } catch (err) {
        console.error(`\x1b[31mError sending message: ${err.message}\x1b[0m`)
        isBusy = false
      }
      rl.prompt()
      return
    }

    if (text === '/approve' || text.startsWith('/approve')) {
      try {
        await apiRequest(`${fullSessionId}:approvePlan`, 'POST', {})
        console.log('\x1b[32m✔ Plan approved!\x1b[0m')
        clearTimeout(tailTimeout)
        tailTimeout = setTimeout(async () => {
          await poll()
        }, 2000)
      } catch (err) {
        console.error(`\x1b[31m❌ Error approving plan: ${err.message}\x1b[0m`)
      }
      rl.prompt()
      return
    }

    if (text.startsWith('/upload')) {
      const parts = text.split(/\s+/).filter(Boolean)
      if (parts.length === 1) {
        console.error('\x1b[31m❌ Error: /upload requires a <filepath> argument.\x1b[0m')
        rl.prompt()
        return
      }
      if (parts.length > 2) {
        console.error('\x1b[31m❌ Error: /upload expects strictly 1 argument (<filepath>). Additional text or arguments are not allowed.\x1b[0m')
        rl.prompt()
        return
      }
      const filepath = parts[1]
      try {
        const formatted = readAndFormatLocalFile(filepath)
        if (isBusy) {
          messageQueue.push(formatted.trim())
          saveQueue(fullSessionId, messageQueue)
          updatePrompt()
          console.log('\x1b[33m⏳ Jules is working. File uploaded and queued. (Type /flush to send immediately)\x1b[0m')
        } else {
          isBusy = true
          try {
            await apiRequest(`${fullSessionId}:sendMessage`, 'POST', { prompt: formatted.trim() })
            console.log('\x1b[90m(File uploaded... Agent is thinking...)\x1b[0m')
            clearTimeout(tailTimeout)
            tailTimeout = setTimeout(async () => {
              await poll()
            }, 2000)
          } catch (err) {
            console.error(`\x1b[31mError sending file message: ${err.message}\x1b[0m`)
            isBusy = false
          }
        }
      } catch (err) {
        console.error(`\x1b[31m❌ Error uploading file: ${err.message}\x1b[0m`)
      }
      rl.prompt()
      return
    }

    let promptToSend = text
    try {
      promptToSend = expandAtFilepaths(text)
    } catch (err) {
      console.error(`\x1b[31m❌ Error reading file: ${err.message}\x1b[0m`)
      rl.prompt()
      return
    }

    if (isBusy || messageQueue.length > 0) {
      messageQueue.push(promptToSend)
      saveQueue(fullSessionId, messageQueue)
      updatePrompt()
      console.log('\x1b[33m⏳ Jules is working. Message queued and will be sent automatically when Jules is ready. (Type /flush to send immediately)\x1b[0m')
      rl.prompt()
      return
    }

    try {
      const session = await apiRequest(fullSessionId, 'GET', null, true)
      if (session.state === 'IN_PROGRESS' || session.state === 'ACTIVE') {
        isBusy = true
        messageQueue.push(promptToSend)
        saveQueue(fullSessionId, messageQueue)
        updatePrompt()
        console.log('\x1b[33m⏳ Jules is working. Message queued and will be sent automatically when Jules is ready. (Type /flush to send immediately)\x1b[0m')
        rl.prompt()
        return
      }
    } catch (err) {
      log(`Pre-send session state check failed: ${err.message}`)
    }

    isBusy = true
    hasPulledForWork = false
    try {
      await apiRequest(`${fullSessionId}:sendMessage`, 'POST', { prompt: promptToSend })
      console.log('\x1b[90m(Message sent... Agent is thinking...)\x1b[0m')
      clearTimeout(tailTimeout)
      tailTimeout = setTimeout(async () => {
        await poll()
      }, 2000)
    } catch (err) {
      console.error(`\x1b[31mError sending message: ${err.message}\x1b[0m`)
      isBusy = false
    }
    rl.prompt()
  })

  rl.on('close', () => {
    clearTimeout(tailTimeout)
    process.exit(0)
  })
}

export function registerReplCommand (yargs) {
  return yargs.command(
    'repl [sessionIdOrPrompt]',
    'Interactive shell to chat with a session (supports /upload, /approve, /rename, /flush, /help, @filepath)',
    (y) => {
      return y
        .positional('sessionIdOrPrompt', { type: 'string', describe: 'Session ID or initial prompt' })
        .option('c', { alias: 'create', type: 'boolean', describe: 'Create a new session (requires a prompt argument)' })
        .option('source', { type: 'string', describe: 'Link or filter by a specific code source' })
        .option('name', { type: 'string', describe: 'Set a custom display name/label for the REPL prompt' })
        .option('history', { type: 'boolean', describe: 'Fetch and print full activity history on startup' })
        .option('git-pull', { type: 'boolean', describe: "Automatically run 'git pull' before starting the REPL" })
        .option('git-patch', { type: 'boolean', describe: 'Automatically apply received git patches to repository' })
    },
    async (argv) => {
      if (argv.create) {
        if (argv.session) {
          console.error('\x1b[31m❌ Error: Cannot specify `--session` option when creating a new session.\x1b[0m')
          process.exit(1)
        }
        if (!argv.sessionIdOrPrompt) {
          console.error('\x1b[31m❌ Error: A prompt argument is required when using `--create`.\x1b[0m')
          process.exit(1)
        }
        let initialPrompt = argv.sessionIdOrPrompt
        try {
          initialPrompt = expandAtFilepaths(argv.sessionIdOrPrompt)
        } catch (err) {
          console.error(`\x1b[31m❌ Error reading file: ${err.message}\x1b[0m`)
          process.exit(1)
        }
        const newSessionId = await createSession(initialPrompt, argv.source)
        await repl(newSessionId, argv)
        return
      }

      const explicitSessionId = argv.session || argv.sessionIdOrPrompt

      if (explicitSessionId) {
        if (argv.source) {
          console.log('\x1b[33m⚠️ Warning: Specifying `--source` is not necessary when passing an explicit session ID.\x1b[0m')
        }
        await repl(explicitSessionId, argv)
        return
      }

      if (argv.source) {
        let fullSourceId = argv.source
        if (typeof fullSourceId === 'string' && !fullSourceId.startsWith('sources/')) {
          try {
            const sources = await fetchSources()
            const matched = sources.find(s => s.githubRepo && `${s.githubRepo.owner}/${s.githubRepo.repo}` === argv.source)
            if (matched) fullSourceId = matched.name
          } catch (err) {
            log(`Failed to resolve source in REPL: ${err.message}`)
          }
        }

        try {
          const sessions = await fetchSessions()
          const matchingSessions = sessions.filter(s => {
            const sSource = s.sourceContext || s.source || s.sourceId
            return sSource === fullSourceId || sSource === argv.source
          })

          if (matchingSessions.length === 0) {
            console.error(`\x1b[31m❌ Error: No existing sessions found for source '${argv.source}'. Pass '--create <prompt>' to start a new session.\x1b[0m`)
            process.exit(1)
          }

          const latestSession = matchingSessions[0].name || matchingSessions[0].id
          console.log(`\x1b[90mConnecting to latest session for ${argv.source}: ${latestSession}\x1b[0m`)
          await repl(latestSession, argv)
        } catch (err) {
          console.error(`\x1b[31m❌ Error fetching sessions for source: ${err.message}\x1b[0m`)
          process.exit(1)
        }
        return
      }

      await repl(null, argv)
    }
  )
}
