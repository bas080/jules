import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync, execFileSync } from 'child_process'
import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'
import NodeFetchCache, { FileSystemCache } from 'node-fetch-cache'
import debug from 'debug'
import notifier from 'node-notifier'
import { computeInterdiff } from './interdiff.mjs'

export const log = debug('jules')

export function sendDesktopNotification (title, message, options = {}) {
  if (options.notify === false) return
  if (process.env.JULES_NOTIFY === 'false' || process.env.JULES_NOTIFY === '0') return

  try {
    if (process.stderr && process.stderr.isTTY) {
      process.stderr.write('\x07')
    }
  } catch (e) {}

  try {
    notifier.notify({
      title: title || 'Jules AI Session',
      message: message || 'Jules is done and awaiting your input.',
      sound: options.sound !== false
    })
  } catch (err) {
    log(`Desktop notification failed: ${err.message}`)
  }
}

export const API_KEY = process.env.JULES_API_KEY
export const BASE_URL = process.env.JULES_API_URL || 'https://jules.googleapis.com/v1alpha'

const cachedFetch = NodeFetchCache.create({
  cache: new FileSystemCache({
    cacheDir: path.join(os.homedir(), '.jules-cache')
  })
})

export function isColorSupported () {
  if (process.env.NO_COLOR || process.argv.includes('--no-color')) return false
  if (process.env.FORCE_COLOR) return true
  return Boolean(process.stdout && process.stdout.isTTY)
}

export function renderMarkdown (mdText, customWidth = null) {
  if (!mdText) return ''
  if (!isColorSupported()) return mdText

  const termWidth = customWidth || (process.stdout && process.stdout.columns ? Math.max(process.stdout.columns - 2, 80) : 120)

  const renderer = new TerminalRenderer({
    showSectionPrefix: false,
    tab: 2,
    width: termWidth,
    reflowText: true
  })

  marked.setOptions({ renderer })
  return marked(mdText).trim()
}

export const sessionPatches = new Map()

export function getInterdiff (previousPatch, currentPatch, sessionId) {
  const cleanId = sessionId ? sessionId.replace(/^sessions\//, '') : 'session'
  const diff = computeInterdiff(previousPatch, currentPatch, `a/${cleanId}`, `b/${cleanId}`)
  return diff
}

export async function getPreviousPatchFromHistory (sessionId, index = null, activities = null) {
  const cleanId = sessionId ? sessionId.replace(/^sessions\//, '') : 'session'
  if (sessionPatches.has(cleanId)) {
    return sessionPatches.get(cleanId)
  }

  let actList = activities
  if (!actList && sessionId) {
    try {
      actList = await fetchAllActivities(sessionId)
    } catch (err) {
      log(`Failed to fetch activity history for previous patch: ${err.message}`)
    }
  }

  if (Array.isArray(actList)) {
    const checkIdx = (index !== null && index !== undefined && index >= 0) ? index - 1 : actList.length - 1
    for (let i = checkIdx; i >= 0; i--) {
      const act = actList[i]
      if (act && act.artifacts && Array.isArray(act.artifacts)) {
        for (const art of act.artifacts) {
          if (art && art.changeSet && art.changeSet.gitPatch && art.changeSet.gitPatch.unidiffPatch) {
            return art.changeSet.gitPatch.unidiffPatch
          }
        }
      }
    }
  }

  return ''
}

export function readAndFormatLocalFile (filepath) {
  const resolvedPath = path.resolve(filepath)
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filepath}`)
  }

  const stat = fs.statSync(resolvedPath)
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${filepath}`)
  }

  const buffer = fs.readFileSync(resolvedPath)
  const isLikelyBinary = buffer.slice(0, 8000).includes(0)
  const ext = path.extname(filepath).toLowerCase()
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']

  if (isLikelyBinary || imageExts.includes(ext)) {
    throw new Error(`Binary/image files are not supported for text attachment: ${filepath}`)
  }

  const content = buffer.toString('utf8')
  return `\n\n--- File: ${filepath} ---\n${content}\n`
}

export async function readStdin () {
  return new Promise((resolve) => {
    let data = ''
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => {
      resolve(data)
    })
  })
}

export async function apiRequest (endpoint, method = 'GET', body = null, bypassCache = false, retries = 3) {
  const disableCacheEnv = process.env.JULES_DISABLE_CACHE === 'true' || process.env.JULES_DISABLE_CACHE === '1'
  const isMutation = method.toUpperCase() !== 'GET'
  const shouldBypass = bypassCache || disableCacheEnv || isMutation

  log(`API Request: ${method} ${endpoint} (bypassCache: ${shouldBypass})`)
  const options = {
    method,
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'Content-Type': 'application/json'
    }
  }
  if (body) {
    log('Request Body: %O', body)
    options.body = JSON.stringify(body)
  }

  const fetcher = shouldBypass ? fetch : cachedFetch
  let attempt = 0
  while (true) {
    const res = await fetcher(`${BASE_URL}/${endpoint}`, options)
    if (!res.ok) {
      const errorText = await res.text()
      log(`API Error: ${res.status} - ${errorText}`)
      if (res.status === 429 && attempt < retries) {
        attempt++
        const backoffDelay = process.env.JULES_POLL_INTERVAL ? 10 : Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 500)
        log(`HTTP 429 encountered in apiRequest. Retrying in ${backoffDelay}ms (attempt ${attempt}/${retries})...`)
        await new Promise((resolve) => setTimeout(resolve, backoffDelay))
        continue
      }
      const err = new Error(`API Error (${res.status}): ${errorText}`)
      err.status = res.status
      throw err
    }
    const data = await res.json()
    log(`API Response from ${endpoint}: %O`, data)
    return data
  }
}

export async function fetchSources () {
  const response = await apiRequest('sources', 'GET', null, true)
  const sources = Array.isArray(response) ? response : response.sources
  if (!Array.isArray(sources)) {
    throw new Error('Unexpected response format from API')
  }
  return sources
}

export async function fetchSessions () {
  const response = await apiRequest('sessions', 'GET', null, true)
  const sessions = Array.isArray(response) ? response : response.sessions
  if (!Array.isArray(sessions)) {
    throw new Error('Unexpected response format from API')
  }
  return sessions
}

export function formatSourceDisplay (s) {
  if (!s) return 'none'
  let display = typeof s === 'object' ? (s.source || s.name || s.sourceContext || String(s)) : String(s)
  if (typeof display === 'object') {
    display = display.source || display.name || String(display)
  }
  if (display.startsWith('sources/github/')) {
    display = display.replace(/^sources\/github\//, '')
  } else if (display.startsWith('sources/')) {
    display = display.replace(/^sources\//, '')
  }
  return display
}

export function listSessionsFromList (sessions) {
  const termCols = process.stdout && process.stdout.columns ? process.stdout.columns : 100
  const maxColWidth = Math.max(15, Math.floor((termCols - 20) / 4))

  function formatCell (val) {
    if (!val) return ''
    const clean = String(val).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
    if (clean.length <= maxColWidth) return clean
    return clean.slice(0, Math.max(0, maxColWidth - 3)) + '...'
  }

  let table = '| Session ID | Source | State | Created Time |\n'
  table += '| --- | --- | --- | --- |\n'

  sessions.forEach((s) => {
    const id = formatCell(s.name || s.id || 'unknown')
    const rawSource = s.sourceContext || s.source || s.sourceId
    const sourceDisplay = formatCell(formatSourceDisplay(rawSource))
    const state = formatCell(s.state || 'UNKNOWN')
    const created = formatCell(s.createTime || 'unknown')

    table += `| ${id} | ${sourceDisplay} | ${state} | ${created} |\n`
  })

  console.log(`\n${renderMarkdown(table)}\n`)
}

export async function fetchAllActivities (sessionId) {
  let allActivities = []
  let pageToken = null

  do {
    const endpoint = pageToken
      ? `${sessionId}/activities?pageToken=${pageToken}`
      : `${sessionId}/activities`
    const response = await apiRequest(endpoint, 'GET', null, true)

    const activities = response.activities || []
    allActivities = allActivities.concat(activities)
    pageToken = response.nextPageToken
  } while (pageToken)

  return allActivities
}

export function hasJulesFinishedWork (activities = [], session = {}) {
  if (session.state === 'AWAITING_USER_INPUT' || session.state === 'COMPLETED') {
    return true
  }
  if (activities.length === 0) return false
  const lastAct = activities[activities.length - 1]
  if (lastAct.sessionCompleted || lastAct.sessionFailed) return true
  if (lastAct.planGenerated || lastAct.agentMessaged || lastAct.planApproved) return true
  for (let i = activities.length - 1; i >= 0; i--) {
    const act = activities[i]
    if (act.artifacts && Array.isArray(act.artifacts)) {
      for (const art of act.artifacts) {
        if (art.changeSet && art.changeSet.gitPatch) return true
      }
    }
  }
  return false
}

export function openUrlInBrowser (url) {
  const platform = process.platform
  try {
    if (platform === 'darwin') {
      execSync(`open "${url}"`)
    } else if (platform === 'win32') {
      execSync(`start "" "${url}"`)
    } else {
      execSync(`xdg-open "${url}"`)
    }
  } catch (err) {
    log(`Failed to open URL in browser automatically: ${err.message}`)
  }
}

export function isRateLimitError (err) {
  return Boolean((err && err.status === 429) || (err && err.message && err.message.includes('429')))
}

export function getNextRateLimitInterval (currentInterval, baseInterval = 3000, maxInterval = 30000) {
  if (process.env.JULES_POLL_INTERVAL) {
    return parseInt(process.env.JULES_POLL_INTERVAL, 10)
  }
  const minBackoff = baseInterval * 2
  return Math.min(Math.max(currentInterval * 2, minBackoff), maxInterval)
}

export function stepDownPollInterval (currentInterval, baseInterval = 3000) {
  return Math.max(baseInterval, Math.round(currentInterval / 1.5))
}

export function handlePollingError (err, context = 'background loop') {
  if (isRateLimitError(err)) {
    if (process.env.DEBUG) {
      console.log(`\x1b[31mError in ${context}: ${err.message}\x1b[0m`)
    } else {
      console.log('\x1b[33m⚠️ Rate limit reached (HTTP 429). Retrying with backoff...\x1b[0m')
    }
  } else if (err.message && err.message.includes('API Error (404)')) {
    log('Resource not yet available (404), retrying...')
  } else {
    console.error(`\x1b[31mError in ${context}: ${err.message}\x1b[0m`)
  }
}

export function getActivityType (activity = {}) {
  if (activity.type) return activity.type
  if (activity.agentMessaged) return 'agentMessaged'
  if (activity.userMessaged) return 'userMessaged'
  if (activity.planGenerated) return 'planGenerated'
  if (activity.planApproved) return 'planApproved'
  if (activity.progressUpdated) return 'progressUpdated'
  if (activity.sessionCompleted) return 'sessionCompleted'
  if (activity.sessionFailed) return 'sessionFailed'
  if (activity.artifacts) return 'artifactsGenerated'
  return 'unknown'
}

export async function printActivity (index, activity, sessionId = null, options = {}) {
  log(`Printing Activity ${index}: %O`, activity)
  const time = activity.createTime ? `\x1b[90m[${activity.createTime}]\x1b[0m ` : ''
  const originator = activity.originator || 'Unknown'

  let color = '\x1b[37m'
  if (originator === 'AGENT') color = '\x1b[34m'
  if (originator === 'USER') color = '\x1b[32m'

  console.error(`\n\x1b[1m--- Activity ${index} ---\x1b[0m`)
  console.error(`${time}${color}${originator}\x1b[0m`)
  console.error(`\x1b[90mType:\x1b[0m ${getActivityType(activity)}`)

  if (activity.agentMessaged && activity.agentMessaged.agentMessage) {
    console.log(`\n${renderMarkdown(activity.agentMessaged.agentMessage)}\n`)
  } else if (activity.userMessaged && activity.userMessaged.userMessage) {
    console.log(`\n${renderMarkdown(activity.userMessaged.userMessage)}\n`)
  } else if (activity.planGenerated) {
    const plan = activity.planGenerated.plan
    console.error(`\n\x1b[33m📋 Plan Generated (ID: ${plan.id || 'unknown'})\x1b[0m`)
    let planMd = ''
    if (plan.steps && Array.isArray(plan.steps)) {
      plan.steps.forEach((step, i) => {
        planMd += `${i + 1}. **${step.title || 'Step'}**: ${step.description || ''}\n`
      })
    }
    if (planMd) console.log(`\n${renderMarkdown(planMd)}\n`)
    sendDesktopNotification('Jules AI Plan Generated', 'A plan has been generated and requires approval (/approve).', options)
  } else if (activity.planApproved) {
    console.error(`\n\x1b[32m✔ Plan Approved (ID: ${activity.planApproved.planId})\x1b[0m\n`)
  } else if (activity.progressUpdated) {
    const prog = activity.progressUpdated
    let md = ''
    if (prog.title) md += `# ${prog.title}\n\n`
    if (prog.description) md += `${prog.description}\n`
    if (md) console.log(`\n${renderMarkdown(md)}\n`)
  } else if (activity.sessionCompleted) {
    console.error('\n\x1b[32m🎉 Session Completed Successfully\x1b[0m\n')
  } else if (activity.sessionFailed && activity.sessionFailed.reason) {
    console.error('\n\x1b[31m❌ Session Failed\x1b[0m')
    console.error(`Reason: ${activity.sessionFailed.reason}\n`)
  }

  for (const [key, value] of Object.entries(activity)) {
    if (['type', 'createTime', 'name', 'originator', 'agentMessaged', 'userMessaged', 'id', 'planGenerated', 'planApproved', 'sessionCompleted', 'sessionFailed', 'progressUpdated'].includes(key)) continue

    if (key === 'artifacts' && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const art = value[i]
        console.error(`\x1b[32mArtifact ${i}:\x1b[0m`)
        if (art.changeSet && art.changeSet.gitPatch && art.changeSet.gitPatch.unidiffPatch) {
          const currentPatch = art.changeSet.gitPatch.unidiffPatch
          const cleanId = sessionId ? sessionId.replace(/^sessions\//, '') : 'session'
          const previousPatch = await getPreviousPatchFromHistory(sessionId, index, options.activities)

          try {
            const tmpPath = path.join(os.tmpdir(), `jules-${cleanId}.patch`)
            fs.writeFileSync(tmpPath, currentPatch, 'utf8')
            console.error(`\x1b[36m📄 Patch saved to:\x1b[0m ${tmpPath}`)
            console.error(`\x1b[90m💡 Apply to repository:\x1b[0m git apply ${tmpPath}\n`)

            if (options && options.gitPatch) {
              try {
                execFileSync('git', ['apply', tmpPath], { cwd: process.cwd(), encoding: 'utf8' })
                console.error(`\x1b[32m✔ Automatically applied git patch to repository:\x1b[0m git apply ${tmpPath}\n`)
              } catch (applyErr) {
                console.error(`\x1b[31m❌ Error automatically applying git patch: ${applyErr.message}\x1b[0m\n`)
              }
            }
          } catch (err) {
            console.error(`\x1b[31mFailed to save patch file: ${err.message}\x1b[0m`)
          }

          const interdiff = getInterdiff(previousPatch, currentPatch, sessionId)
          sessionPatches.set(cleanId, currentPatch)

          if (interdiff && interdiff.trim()) {
            console.error('\x1b[36mStep Interdiff:\x1b[0m')
            console.log(renderMarkdown(`\`\`\`diff\n${interdiff}\n\`\`\``))
          }
        } else if (art.bashOutput) {
          const bo = art.bashOutput
          console.error(`\x1b[36mCommand:\x1b[0m ${bo.command || 'N/A'}`)
          if (bo.output) {
            console.log(renderMarkdown(`\`\`\`\n${bo.output}\n\`\`\``))
          }
          console.error(`\x1b[90mExit Code:\x1b[0m ${bo.exitCode !== undefined ? bo.exitCode : 'N/A'}\n`)
        } else {
          console.log(renderMarkdown(`\`\`\`json\n${JSON.stringify(art, null, 2)}\n\`\`\``))
        }
      }
    } else {
      console.error(`\x1b[32m${key}:\x1b[0m`)
      console.log(renderMarkdown(`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``))
    }
  }
}

export function getSessionStateFilePath (sessionId) {
  const cleanId = sessionId.replace(/^sessions\//, '')
  const stateDir = path.join(os.homedir(), '.jules-cache', 'sessions')
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true })
  }
  return path.join(stateDir, `${cleanId}.json`)
}

export function saveSessionState (sessionId, stateObj) {
  try {
    const stateFile = getSessionStateFilePath(sessionId)
    if (!stateObj.name && !stateObj.color && (!stateObj.queue || stateObj.queue.length === 0) && !stateObj.queueMode && !stateObj.queueDispatch && stateObj.autoSend === undefined) {
      if (fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile)
      }
    } else {
      fs.writeFileSync(stateFile, JSON.stringify(stateObj, null, 2), 'utf8')
    }
  } catch (err) {
    log(`Failed to save session state for ${sessionId}: ${err.message}`)
  }
}

export function loadSessionState (sessionId) {
  try {
    const stateFile = getSessionStateFilePath(sessionId)
    if (fs.existsSync(stateFile)) {
      const data = fs.readFileSync(stateFile, 'utf8')
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === 'object') {
        return {
          name: parsed.name || null,
          color: parsed.color || null,
          queue: Array.isArray(parsed.queue) ? parsed.queue : [],
          queueMode: parsed.queueMode || null,
          queueDispatch: parsed.queueDispatch || null,
          autoSend: parsed.autoSend !== undefined ? Boolean(parsed.autoSend) : null
        }
      }
    }
  } catch (err) {
    log(`Failed to load session state for ${sessionId}: ${err.message}`)
  }
  return { name: null, color: null, queue: [], queueMode: null, queueDispatch: null, autoSend: null }
}
