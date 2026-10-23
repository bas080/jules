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
  formatSourceDisplay,
  loadSessionState,
  saveSessionState,
  renderMarkdown,
  sessionPatches,
  sendDesktopNotification,
  log
} from '../common.js'
import { createSession } from './create.js'
import { archiveSession } from './cleanup.js'

export async function repl (sessionId, options = {}) {
  process.title = 'jules-repl'
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

  let fullSessionId = targetSessionId.startsWith('sessions/') ? targetSessionId : `sessions/${targetSessionId}`
  let shortSessionId = fullSessionId.replace(/^sessions\//, '')

  const sessionState = loadSessionState(fullSessionId)
  let basePromptLabel = sessionState.name

  if (options.name) {
    basePromptLabel = options.name
    sessionState.name = options.name
    saveSessionState(fullSessionId, sessionState)
  } else if (!basePromptLabel) {
    try {
      const sessionInfo = await apiRequest(fullSessionId, 'GET', null, true)
      const rawSource = sessionInfo.sourceContext || sessionInfo.source || sessionInfo.sourceId
      if (rawSource) {
        const formatted = formatSourceDisplay(rawSource)
        if (formatted && formatted !== 'none') {
          basePromptLabel = formatted
        }
      }
    } catch (err) {
      log(`Failed to fetch session info for prompt source label: ${err.message}`)
    }
    if (!basePromptLabel) {
      basePromptLabel = shortSessionId
    }
  }

  const bgColors = {
    green: '\x1b[42m\x1b[30m',
    cyan: '\x1b[46m\x1b[30m',
    blue: '\x1b[44m\x1b[37m',
    yellow: '\x1b[43m\x1b[30m',
    magenta: '\x1b[45m\x1b[37m',
    red: '\x1b[41m\x1b[37m',
    white: '\x1b[47m\x1b[30m',
    reset: '\x1b[0m',
    none: '\x1b[0m',
    default: '\x1b[42m\x1b[30m'
  }

  let promptColorCode = bgColors[sessionState.color] || bgColors.default

  console.log(`\x1b[36mJules REPL started for session:\x1b[0m ${fullSessionId}`)
  console.log('\x1b[90mType your message and press Enter. Press Ctrl+C to exit.\x1b[0m\n')

  function saveQueue (sessionId, queue) {
    sessionState.queue = queue
    saveSessionState(sessionId, sessionState)
  }

  let isBusy = false
  const messageQueue = sessionState.queue
  let lastSeenActivityIndex = -1
  let lastState = null
  let lastUpdateTime = null
  let idlePollCount = 0
  let isPollingPaused = false
  const maxIdlePolls = 20

  let queueDispatch = (options.queueDispatch || options['queue-dispatch'] || process.env.JULES_QUEUE_DISPATCH || sessionState.queueDispatch || 'bulk').toLowerCase()
  if (queueDispatch !== 'single' && queueDispatch !== 'one') queueDispatch = 'bulk'

  let queueMode = (options.queueMode || options['queue-mode'] || process.env.JULES_QUEUE_MODE || sessionState.queueMode || 'direct').toLowerCase()
  if (queueMode !== 'buffered' && queueMode !== 'first') queueMode = 'direct'

  let autoSend = true
  if (options.autoSend === false || options['auto-send'] === false) {
    autoSend = false
  } else if (process.env.JULES_AUTO_SEND === 'false' || process.env.JULES_AUTO_SEND === '0') {
    autoSend = false
  } else if (sessionState.autoSend !== null && sessionState.autoSend !== undefined) {
    autoSend = sessionState.autoSend
  }

  function resumePolling () {
    const wasPaused = isPollingPaused
    idlePollCount = 0
    if (wasPaused) {
      isPollingPaused = false
      lastUpdateTime = null
      console.log('\n\x1b[36m⏰ Activity detected. Waking up and checking for session updates...\x1b[0m')
      clearTimeout(tailTimeout)
      tailTimeout = setTimeout(poll, 0)
    }
  }

  const onStdinData = () => {
    resumePolling()
  }
  process.stdin.on('data', onStdinData)

  function getStatusIcon () {
    if (isBusy || lastState === 'IN_PROGRESS' || lastState === 'ACTIVE') return '⚙'
    if (lastState === 'COMPLETED') return '✔'
    if (lastState === 'FAILED') return '✖'
    if (lastState === 'CANCELLED') return '⏹'
    return '✎'
  }

  function getPromptString () {
    const icon = getStatusIcon()
    const queueSuffix = messageQueue.length > 0 ? ` [${messageQueue.length}]` : ''
    return `${promptColorCode} ${icon} ${basePromptLabel}${queueSuffix} \x1b[0m `
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPromptString()
  })

  function updatePrompt () {
    if (!rl.closed) {
      try {
        rl.setPrompt(getPromptString())
      } catch (e) {}
    }
  }

  function safePrompt (preserveCursor) {
    if (!rl.closed) {
      try {
        rl.prompt(preserveCursor)
      } catch (e) {}
    }
  }

  const onSigCont = () => {
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
      }
      process.stdin.resume()
      if (!rl.closed) {
        rl.resume()
        updatePrompt()
        safePrompt(true)
      }
      clearTimeout(tailTimeout)
      tailTimeout = setTimeout(poll, 50)
    } catch (err) {
      log(`SIGCONT handler error: ${err.message}`)
    }
  }
  process.on('SIGCONT', onSigCont)

  rl.prompt()

  async function flushQueue (dispatchType = queueDispatch, force = false) {
    if (messageQueue.length > 0 && (!isBusy || force)) {
      let payload = ''
      if (dispatchType === 'single' || dispatchType === 'one') {
        payload = messageQueue.shift()
      } else {
        payload = messageQueue.join('\n\n---\n\n')
        messageQueue.length = 0
      }
      saveQueue(fullSessionId, messageQueue)
      isBusy = true
      lastState = 'IN_PROGRESS'
      updatePrompt()
      console.log('\n\x1b[36m📤 Sending queued message(s) to Jules...\x1b[0m')
      try {
        await apiRequest(`${fullSessionId}:sendMessage`, 'POST', { prompt: payload })
        console.log('\x1b[90m(Messages flushed and sent immediately... Agent is thinking...)\x1b[0m')
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
        const wasWorking = (lastState === 'IN_PROGRESS' || lastState === 'ACTIVE')
        lastState = session.state
        if (session.state === 'AWAITING_USER_INPUT' || session.state === 'AWAITING_USER_FEEDBACK' || session.state === 'COMPLETED' || session.state === 'FAILED' || session.state === 'CANCELLED') {
          isBusy = false
          if (wasWorking && (session.state === 'AWAITING_USER_INPUT' || session.state === 'AWAITING_USER_FEEDBACK' || session.state === 'COMPLETED')) {
            sendDesktopNotification(
              `Jules AI (${basePromptLabel})`,
              `Jules is now ${session.state.toLowerCase().replace(/_/g, ' ')}.`,
              options
            )
          }
        } else if (session.state === 'IN_PROGRESS' || session.state === 'ACTIVE') {
          isBusy = true
        }
        safePrompt(true)
      }

      if (session.updateTime !== lastUpdateTime) {
        idlePollCount = 0
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
          safePrompt(true)
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
        if (queueMode === 'direct' && autoSend) {
          await flushQueue(queueDispatch)
        }
      }

      if (!isBusy && (session.state === 'AWAITING_USER_INPUT' || session.state === 'AWAITING_USER_FEEDBACK' || session.state === 'COMPLETED' || session.state === 'FAILED' || session.state === 'CANCELLED')) {
        idlePollCount++
        if (idlePollCount >= maxIdlePolls) {
          if (!isPollingPaused) {
            isPollingPaused = true
            console.log('\n\x1b[33m💤 REPL background polling paused due to inactivity.\x1b[0m')
            console.log('\x1b[90m💡 Press Enter or type a message to wake up and fetch latest session updates.\x1b[0m\n')
            safePrompt(true)
          }
          log('Polling paused due to idle inactivity. Waiting for user interaction to resume.')
          return
        }
      }

      currentPollInterval = basePollInterval
    } catch (err) {
      if (isRateLimitError(err)) {
        currentPollInterval = Math.min(currentPollInterval * 2, 30000)
      }
      handlePollingError(err, 'REPL background loop')
      safePrompt(true)
    }

    if (!rl.closed) {
      tailTimeout = setTimeout(poll, currentPollInterval)
    }
  }

  let tailTimeout = setTimeout(poll, 0)

  rl.on('line', async (line) => {
    resumePolling()
    const text = line.trim()
    if (!text) {
      rl.prompt()
      return
    }

    if (text.startsWith('/')) {
      const knownCommands = ['/archive', '/status', '/web', '/clear', '/diff', '/help', '/color', '/edit', '/queue', '/rename', '/flush', '/send', '/now', '/approve', '/upload', '/history', '/new', '/pr', '/notify', '/autosend']
      const cmdToken = text.split(/\s+/)[0].toLowerCase()
      if (!knownCommands.includes(cmdToken)) {
        console.error(`\x1b[33m⚠️ Warning: Unknown REPL command '${cmdToken}'. Type /help to list available commands.\x1b[0m`)
        rl.prompt()
        return
      }
    }

    if (text === '/archive' || text.startsWith('/archive')) {
      try {
        await archiveSession(fullSessionId)
        console.log('\x1b[32m✔ Session archived.\x1b[0m')
        rl.close()
      } catch (err) {
        console.error(`\x1b[31m❌ Error archiving session: ${err.message}\x1b[0m`)
        rl.prompt()
      }
      return
    }

    if (text === '/status' || text.startsWith('/status')) {
      try {
        const cleanId = fullSessionId.replace(/^sessions\//, '')
        const sessionInfo = await apiRequest(fullSessionId, 'GET', null, true)
        const rawSource = sessionInfo.sourceContext || sessionInfo.source || sessionInfo.sourceId
        const sourceDisplay = formatSourceDisplay(rawSource)

        let branch = null
        if (sessionInfo.sourceContext && sessionInfo.sourceContext.githubRepoContext && sessionInfo.sourceContext.githubRepoContext.startingBranch) {
          branch = sessionInfo.sourceContext.githubRepoContext.startingBranch
        } else if (sessionInfo.startingBranch) {
          branch = sessionInfo.startingBranch
        }

        let prUrl = null
        let lastUserMessage = null

        if (sessionInfo.outputs && Array.isArray(sessionInfo.outputs)) {
          for (const out of sessionInfo.outputs) {
            if (out.pullRequest && out.pullRequest.url) {
              prUrl = out.pullRequest.url
              break
            }
          }
        }

        try {
          const activities = await fetchAllActivities(fullSessionId)
          for (let i = activities.length - 1; i >= 0; i--) {
            const act = activities[i]
            if (!lastUserMessage && act.userMessaged && act.userMessaged.userMessage) {
              lastUserMessage = act.userMessaged.userMessage.trim()
            }
            if (!prUrl && act.artifacts && Array.isArray(act.artifacts)) {
              for (const art of act.artifacts) {
                if (art.pullRequest && art.pullRequest.url) {
                  prUrl = art.pullRequest.url
                  break
                }
              }
            }
            if (prUrl && lastUserMessage) break
          }
        } catch (err) {
          log(`Failed to fetch activities for /status: ${err.message}`)
        }

        let statusMd = '# Session Status\n\n'
        statusMd += '| Property | Value |\n| --- | --- |\n'
        statusMd += `| **session** | ${fullSessionId} |\n`
        if (sourceDisplay && sourceDisplay !== 'none') statusMd += `| **source** | ${sourceDisplay} |\n`
        if (branch) statusMd += `| **branch** | ${branch} |\n`
        if (sessionInfo.title) statusMd += `| **title** | ${sessionInfo.title} |\n`
        if (sessionInfo.state) statusMd += `| **state** | ${sessionInfo.state} |\n`
        if (lastUserMessage) statusMd += `| **last message** | ${lastUserMessage.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`
        if (sessionInfo.createTime) statusMd += `| **created** | ${sessionInfo.createTime} |\n`
        if (sessionInfo.updateTime) statusMd += `| **updated** | ${sessionInfo.updateTime} |\n`
        if (prUrl) statusMd += `| **pr** | ${prUrl} |\n`
        else statusMd += '| **pr** | None generated yet |\n'
        statusMd += `| **web** | https://jules.google.com/session/${cleanId} |\n`

        console.log(`\n${renderMarkdown(statusMd)}\n`)
      } catch (err) {
        console.error(`\x1b[31m❌ Error fetching session status: ${err.message}\x1b[0m`)
      }
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

      let patchContent = sessionPatches.get(cleanId) || ''

      if (!patchContent) {
        try {
          const activities = await fetchAllActivities(fullSessionId)
          for (let i = activities.length - 1; i >= 0; i--) {
            const act = activities[i]
            if (act.artifacts && Array.isArray(act.artifacts)) {
              for (const art of act.artifacts) {
                if (art.changeSet && art.changeSet.gitPatch && art.changeSet.gitPatch.unidiffPatch) {
                  patchContent = art.changeSet.gitPatch.unidiffPatch
                  sessionPatches.set(cleanId, patchContent)
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

      if (!patchContent && fs.existsSync(patchPath)) {
        try {
          patchContent = fs.readFileSync(patchPath, 'utf8')
          if (patchContent) sessionPatches.set(cleanId, patchContent)
        } catch (e) {}
      }

      if (!patchContent) {
        console.log('\x1b[90mNo git patch artifacts found for this session.\x1b[0m\n')
      } else {
        try {
          fs.writeFileSync(patchPath, patchContent, 'utf8')
        } catch (e) {}
        console.log(`\n\x1b[36m📄 Latest Patch Artifact (${patchPath}):\x1b[0m\n`)
        console.log(renderMarkdown(`\`\`\`diff\n${patchContent}\n\`\`\``))
        console.log(`\x1b[90m💡 Apply to repository:\x1b[0m git apply ${patchPath}\n`)
      }
      rl.prompt()
      return
    }

    if (text.startsWith('/history')) {
      const parts = text.split(/\s+/).filter(Boolean)
      const count = parts[1] && !isNaN(parseInt(parts[1], 10)) ? parseInt(parts[1], 10) : 5
      try {
        const activities = await fetchAllActivities(fullSessionId)
        const userActivities = activities.filter(a => a.userMessaged && a.userMessaged.userMessage)
        if (userActivities.length === 0) {
          console.log('\x1b[90mNo sent user prompts found for this session.\x1b[0m\n')
        } else {
          const recent = userActivities.slice(-count)
          console.log(`\n\x1b[1mRecent User Prompts (${recent.length}):\x1b[0m`)
          recent.forEach((act, i) => {
            const time = act.createTime ? `\x1b[90m[${new Date(act.createTime).toLocaleTimeString()}]\x1b[0m ` : ''
            const msg = act.userMessaged.userMessage.trim()
            console.log(`  \x1b[36m${i + 1}.\x1b[0m ${time}"${msg}"`)
          })
          console.log('')
        }
      } catch (err) {
        console.error(`\x1b[31m❌ Error fetching history: ${err.message}\x1b[0m`)
      }
      rl.prompt()
      return
    }

    if (text === '/new' || text.startsWith('/new ')) {
      const match = text.match(/^\/new(?:\s+(.*))?$/)
      const promptArg = match && match[1] ? match[1].trim() : ''

      if (!promptArg) {
        console.error('\x1b[31m❌ Error: /new requires a prompt message argument (e.g. /new Fix login bug).\x1b[0m')
        rl.prompt()
        return
      }

      let sourceForNewSession = options.source || null
      try {
        const currentSessionInfo = await apiRequest(fullSessionId, 'GET', null, true)
        const rawSource = currentSessionInfo.sourceContext || currentSessionInfo.source || currentSessionInfo.sourceId
        if (rawSource) {
          const formatted = formatSourceDisplay(rawSource)
          if (formatted && formatted !== 'none') {
            sourceForNewSession = formatted
          }
        }
      } catch (err) {
        log(`Failed to fetch current session source for /new: ${err.message}`)
      }

      try {
        console.log('\n\x1b[36m🚀 Starting a new session for the same source...\x1b[0m')
        const newOptions = { ...options, source: sourceForNewSession || options.source }
        const newSessionId = await createSession(promptArg, sourceForNewSession, newOptions)

        fullSessionId = newSessionId.startsWith('sessions/') ? newSessionId : `sessions/${newSessionId}`
        shortSessionId = fullSessionId.replace(/^sessions\//, '')

        const newSessionState = loadSessionState(fullSessionId)
        Object.assign(sessionState, newSessionState)
        messageQueue.length = 0
        if (newSessionState.queue && newSessionState.queue.length > 0) {
          messageQueue.push(...newSessionState.queue)
        }

        if (options.name) {
          basePromptLabel = options.name
        } else if (sourceForNewSession) {
          basePromptLabel = sourceForNewSession
        } else {
          basePromptLabel = shortSessionId
        }

        lastSeenActivityIndex = -1
        lastState = null
        lastUpdateTime = null
        idlePollCount = 0
        isBusy = true
        hasPulledForWork = false

        updatePrompt()
        console.log(`\x1b[36mJules REPL started for session:\x1b[0m ${fullSessionId}\n`)

        clearTimeout(tailTimeout)
        tailTimeout = setTimeout(poll, 0)
        return
      } catch (err) {
        console.error(`\x1b[31m❌ Error creating new session: ${err.message}\x1b[0m`)
        rl.prompt()
        return
      }
    }

    if (text === '/pr' || text.startsWith('/pr')) {
      try {
        const sessionInfo = await apiRequest(fullSessionId, 'GET', null, true)
        let prUrl = null
        if (sessionInfo.outputs && Array.isArray(sessionInfo.outputs)) {
          for (const out of sessionInfo.outputs) {
            if (out.pullRequest && out.pullRequest.url) {
              prUrl = out.pullRequest.url
              break
            }
          }
        }

        if (!prUrl) {
          try {
            const activities = await fetchAllActivities(fullSessionId)
            for (let i = activities.length - 1; i >= 0; i--) {
              const act = activities[i]
              if (act.artifacts && Array.isArray(act.artifacts)) {
                for (const art of act.artifacts) {
                  if (art.pullRequest && art.pullRequest.url) {
                    prUrl = art.pullRequest.url
                    break
                  }
                }
              }
              if (prUrl) break
            }
          } catch (err) {
            log(`Failed to fetch activities for PR URL: ${err.message}`)
          }
        }

        if (prUrl) {
          console.log(`\x1b[36m🌐 Opening pull request in browser:\x1b[0m ${prUrl}\n`)
          openUrlInBrowser(prUrl)
        } else {
          console.log('\x1b[90mNo pull request URL found for this session.\x1b[0m\n')
        }
      } catch (err) {
        console.error(`\x1b[31m❌ Error fetching PR URL: ${err.message}\x1b[0m`)
      }
      rl.prompt()
      return
    }

    if (text === '/notify' || text.startsWith('/notify')) {
      const parts = text.split(/\s+/).filter(Boolean)
      const arg = parts[1] ? parts[1].toLowerCase() : ''

      if (arg === 'on' || arg === 'true' || arg === 'enable') {
        options.notify = true
        console.error('\x1b[32m✔ Desktop notifications enabled.\x1b[0m')
      } else if (arg === 'off' || arg === 'false' || arg === 'disable') {
        options.notify = false
        console.error('\x1b[32m✔ Desktop notifications disabled.\x1b[0m')
      } else if (arg === 'status') {
        const isEnabled = options.notify !== false && process.env.JULES_NOTIFY !== 'false' && process.env.JULES_NOTIFY !== '0'
        console.log(`\x1b[36mDesktop notifications status:\x1b[0m ${isEnabled ? 'enabled' : 'disabled'}`)
      } else if (!arg) {
        options.notify = !(options.notify !== false)
        console.error(`\x1b[32m✔ Desktop notifications ${options.notify ? 'enabled' : 'disabled'}.\x1b[0m`)
      } else {
        console.error('\x1b[31m❌ Error: Invalid argument for /notify. Usage: /notify [on|off|status]\x1b[0m')
      }
      safePrompt()
      return
    }

    if (text.startsWith('/help')) {
      console.log('\n\x1b[1mAvailable REPL Commands:\x1b[0m')
      console.log('  \x1b[32m/new <msg>\x1b[0m          Start a new session for the same source with initial prompt')
      console.log('  \x1b[32m/archive\x1b[0m           Archive current session and exit REPL')
      console.log('  \x1b[32m/status\x1b[0m            Display current session status and PR URL')
      console.log('  \x1b[32m/pr\x1b[0m                Open related GitHub pull request in browser')
      console.log('  \x1b[32m/notify [on|off]\x1b[0m   Toggle or set desktop notification status')
      console.log('  \x1b[32m/autosend [on|off]\x1b[0m Toggle auto-sending queued messages on idle')
      console.log('  \x1b[32m/upload <filepath>\x1b[0m   Attach and send local text file content')
      console.log('  \x1b[32m/approve\x1b[0m           Approve the generated plan')
      console.log('  \x1b[32m/diff\x1b[0m              View and review latest git patch for the session')
      console.log('  \x1b[32m/rename <name>\x1b[0m       Set a custom display name/label for the REPL prompt')
      console.log('  \x1b[32m/color <color>\x1b[0m      Change prompt color (green, cyan, blue, yellow, magenta, red, white, default)')
      console.log('  \x1b[32m/queue [strategy]\x1b[0m   View or update queue strategy (direct, buffered, bulk, single, auto, manual)')
      console.log('  \x1b[32m/history [count]\x1b[0m    List recent sent user prompts')
      console.log('  \x1b[32m/edit\x1b[0m               Edit currently queued messages in $EDITOR')
      console.log('  \x1b[32m/send [all|one]\x1b[0m     Send queued message(s) immediately (all in bulk or one by one)')
      console.log('  \x1b[32m/flush\x1b[0m              Alias for /send')
      console.log('  \x1b[32m/clear\x1b[0m              Clear terminal screen')
      console.log('  \x1b[32m/web\x1b[0m                Open session URL in web browser')
      console.log('  \x1b[32m/help\x1b[0m               Display this help message\n')
      rl.prompt()
      return
    }

    if (text.startsWith('/color')) {
      const parts = text.split(/\s+/).filter(Boolean)
      const colorArg = parts[1] ? parts[1].toLowerCase() : ''

      if (!colorArg || !bgColors[colorArg]) {
        console.error('\x1b[31m❌ Error: Please specify a valid color: green, cyan, blue, yellow, magenta, red, white, default, reset.\x1b[0m')
        rl.prompt()
        return
      }

      promptColorCode = bgColors[colorArg]
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

    if (text === '/autosend' || text.startsWith('/autosend')) {
      const parts = text.split(/\s+/).filter(Boolean)
      const arg = parts[1] ? parts[1].toLowerCase() : ''

      if (arg === 'on' || arg === 'true' || arg === 'enable') {
        autoSend = true
        sessionState.autoSend = true
        saveSessionState(fullSessionId, sessionState)
        console.log('\x1b[32m✔ Auto-sending queued messages on idle enabled.\x1b[0m')
      } else if (arg === 'off' || arg === 'false' || arg === 'disable') {
        autoSend = false
        sessionState.autoSend = false
        saveSessionState(fullSessionId, sessionState)
        console.log('\x1b[32m✔ Auto-sending queued messages on idle disabled.\x1b[0m')
      } else if (arg === 'status') {
        console.log(`\x1b[36mAuto-send on idle status:\x1b[0m ${autoSend ? 'enabled' : 'disabled'}`)
      } else if (!arg) {
        autoSend = !autoSend
        sessionState.autoSend = autoSend
        saveSessionState(fullSessionId, sessionState)
        console.log(`\x1b[32m✔ Auto-sending queued messages on idle ${autoSend ? 'enabled' : 'disabled'}.\x1b[0m`)
      } else {
        console.error('\x1b[31m❌ Error: Invalid argument for /autosend. Usage: /autosend [on|off|status]\x1b[0m')
      }
      rl.prompt()
      return
    }

    if (text === '/queue' || text.startsWith('/queue')) {
      const parts = text.split(/\s+/).filter(Boolean)
      const strategy = parts[1] ? parts[1].toLowerCase() : ''

      if (!strategy) {
        console.log(`\x1b[36mQueue Settings:\x1b[0m Mode = \x1b[1m${queueMode}\x1b[0m, Dispatch = \x1b[1m${queueDispatch}\x1b[0m, AutoSend = \x1b[1m${autoSend ? 'on' : 'off'}\x1b[0m`)
        if (messageQueue.length === 0) {
          console.log('\x1b[90mNo queued messages.\x1b[0m')
        } else {
          console.log(`\n\x1b[1mQueued Messages (${messageQueue.length}):\x1b[0m`)
          messageQueue.forEach((msg, i) => {
            console.log(`\x1b[36m${i + 1}.\x1b[0m ${msg}`)
          })
          console.log('')
        }
      } else if (strategy === 'direct') {
        queueMode = 'direct'
        sessionState.queueMode = 'direct'
        saveSessionState(fullSessionId, sessionState)
        console.log('\x1b[32m✔ REPL queue mode set to: direct (auto-send when idle).\x1b[0m')
      } else if (strategy === 'buffered' || strategy === 'first') {
        queueMode = 'buffered'
        sessionState.queueMode = 'buffered'
        saveSessionState(fullSessionId, sessionState)
        console.log('\x1b[32m✔ REPL queue mode set to: buffered (writes prompts to queue first).\x1b[0m')
      } else if (strategy === 'bulk' || strategy === 'all') {
        queueDispatch = 'bulk'
        sessionState.queueDispatch = 'bulk'
        saveSessionState(fullSessionId, sessionState)
        console.log('\x1b[32m✔ REPL queue dispatch set to: bulk (sends all queued messages combined).\x1b[0m')
      } else if (strategy === 'single' || strategy === 'one') {
        queueDispatch = 'single'
        sessionState.queueDispatch = 'single'
        saveSessionState(fullSessionId, sessionState)
        console.log('\x1b[32m✔ REPL queue dispatch set to: single (sends queued messages one at a time).\x1b[0m')
      } else if (strategy === 'auto') {
        autoSend = true
        sessionState.autoSend = true
        saveSessionState(fullSessionId, sessionState)
        console.log('\x1b[32m✔ Auto-send on idle set to: auto.\x1b[0m')
      } else if (strategy === 'manual') {
        autoSend = false
        sessionState.autoSend = false
        saveSessionState(fullSessionId, sessionState)
        console.log('\x1b[32m✔ Auto-send on idle set to: manual (requires /send to dispatch).\x1b[0m')
      } else {
        console.error(`\x1b[31m❌ Error: Unknown queue strategy '${strategy}'. Valid strategies: direct, buffered, bulk, single, auto, manual.\x1b[0m`)
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

    if (text === '/send' || text === '/flush' || text === '/now' || text.startsWith('/send ') || text.startsWith('/flush ') || text.startsWith('/now ')) {
      const match = text.match(/^\/(?:send|flush|now)(?:\s+(.*))?$/)
      const arg = match && match[1] ? match[1].trim() : ''
      let dispatchType = queueDispatch

      if (arg === 'all') {
        dispatchType = 'bulk'
      } else if (arg === 'one') {
        dispatchType = 'single'
      } else if (arg) {
        messageQueue.push(arg)
      }

      if (messageQueue.length === 0) {
        console.error('\x1b[31m❌ Error: No queued messages to send.\x1b[0m')
        rl.prompt()
        return
      }

      await flushQueue(dispatchType, true)
      clearTimeout(tailTimeout)
      tailTimeout = setTimeout(async () => {
        await poll()
      }, Math.min(2000, basePollInterval))
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
          lastState = 'IN_PROGRESS'
          updatePrompt()
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

    const promptToSend = text

    if (queueMode === 'buffered') {
      messageQueue.push(promptToSend)
      saveQueue(fullSessionId, messageQueue)
      updatePrompt()
      console.log('\x1b[33m⏳ Message queued (buffered mode). Type /send to dispatch.\x1b[0m')
      rl.prompt()
      return
    }

    if (isBusy || messageQueue.length > 0) {
      messageQueue.push(promptToSend)
      saveQueue(fullSessionId, messageQueue)
      updatePrompt()
      console.log('\x1b[33m⏳ Jules is working. Message queued and will be sent automatically when Jules is ready. (Type /send to send immediately)\x1b[0m')
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
        console.log('\x1b[33m⏳ Jules is working. Message queued and will be sent automatically when Jules is ready. (Type /send to send immediately)\x1b[0m')
        rl.prompt()
        return
      }
    } catch (err) {
      log(`Pre-send session state check failed: ${err.message}`)
    }

    isBusy = true
    lastState = 'IN_PROGRESS'
    updatePrompt()
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
    console.log('')
    process.stdin.removeListener('data', onStdinData)
    process.removeListener('SIGCONT', onSigCont)
    clearTimeout(tailTimeout)
    process.exit(0)
  })
}

export function registerReplCommand (yargs) {
  return yargs.command(
    'repl [prompt]',
    'Interactive shell to chat with a session (supports /upload, /approve, /rename, /flush, /help)',
    (y) => {
      return y
        .positional('prompt', { type: 'string', describe: 'Initial prompt when creating a session' })
        .option('c', { alias: 'create', type: 'boolean', describe: 'Create a new session (requires a prompt argument)' })
        .option('source', { type: 'string', describe: 'Link or filter by a specific code source' })
        .option('starting-branch', { type: 'string', describe: 'Branch to start the session from (defaults to default branch or master)' })
        .option('pr', { type: 'boolean', default: true, describe: 'Automatically create PR when completed (use --no-pr to disable)' })
        .option('title', { type: 'string', describe: 'Set a custom title for the session' })
        .option('plan-approval', { type: 'boolean', default: true, describe: 'Require explicit plan approval before agent starts work (use --no-plan-approval to disable)' })
        .option('name', { type: 'string', describe: 'Set a custom display name/label for the REPL prompt' })
        .option('history', { type: 'boolean', describe: 'Fetch and print full activity history on startup' })
        .option('git-pull', { type: 'boolean', describe: "Automatically run 'git pull' before starting the REPL" })
        .option('git-patch', { type: 'boolean', describe: 'Automatically apply received git patches to repository' })
        .option('notify', { type: 'boolean', default: true, describe: 'Send desktop notifications when Jules becomes idle or requires input' })
        .option('queue-dispatch', { type: 'string', choices: ['bulk', 'single'], describe: 'Configure message queue dispatch behavior (bulk or single)' })
        .option('queue-mode', { type: 'string', choices: ['direct', 'buffered'], describe: 'Configure message queue mode (direct or buffered)' })
        .option('auto-send', { type: 'boolean', default: true, describe: 'Automatically send queued messages when Jules becomes idle (use --no-auto-send to disable)' })
    },
    async (argv) => {
      if (argv.create) {
        if (argv.session) {
          console.error('\x1b[31m❌ Error: Cannot specify `--session` option when creating a new session.\x1b[0m')
          process.exit(1)
        }
        if (!argv.prompt) {
          console.error('\x1b[31m❌ Error: A prompt argument is required when using `--create`.\x1b[0m')
          process.exit(1)
        }
        const newSessionId = await createSession(argv.prompt, argv.source, argv)
        await repl(newSessionId, argv)
        return
      }

      const explicitSessionId = argv.session

      if (explicitSessionId) {
        const isExplicitSource = process.argv.includes('--source') || process.argv.some(a => a.startsWith('--source='))
        if (isExplicitSource) {
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
            const rawSource = s.sourceContext || s.source || s.sourceId
            const formatted = formatSourceDisplay(rawSource)
            const sourceStr = typeof rawSource === 'object' ? (rawSource.source || rawSource.name || rawSource.sourceContext) : String(rawSource)
            return sourceStr === fullSourceId || sourceStr === argv.source || formatted === argv.source || rawSource === fullSourceId || rawSource === argv.source
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
