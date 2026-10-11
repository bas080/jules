import {
  apiRequest,
  fetchAllActivities,
  printActivity,
  readStdin,
  expandAtFilepaths,
  isRateLimitError,
  handlePollingError
} from '../common.js'

export async function sendMessageAndTail (sessionId, message, options = {}) {
  const fullSessionId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`
  console.error(`\x1b[36mSending message to session:\x1b[0m ${fullSessionId}...\n`)

  let lastSeenActivityIndex = -1
  let initialUpdateTime = null
  try {
    const session = await apiRequest(fullSessionId, 'GET', null, true)
    initialUpdateTime = session.updateTime
    const initialActivities = await fetchAllActivities(fullSessionId)
    lastSeenActivityIndex = initialActivities.length - 1
  } catch (err) {
    // If initial fetch fails, start at -1
  }

  await apiRequest(`${fullSessionId}:sendMessage`, 'POST', { prompt: message })
  console.error('\x1b[90m(Message sent... Waiting for Jules to complete...)\x1b[0m\n')

  let lastState = null
  let lastUpdateTime = initialUpdateTime
  let hasCompletedActivity = false
  let hasFailedActivity = false
  let hasStarted = false
  const startIndex = lastSeenActivityIndex

  const basePollInterval = process.env.JULES_POLL_INTERVAL ? parseInt(process.env.JULES_POLL_INTERVAL, 10) : 3000
  let currentPollInterval = basePollInterval

  while (true) {
    try {
      const session = await apiRequest(fullSessionId, 'GET', null, true)

      if (session.state !== lastState) {
        process.stderr.write(`\n\x1b[33m[${new Date().toLocaleTimeString()}] State: ${session.state}\x1b[0m\n`)
        lastState = session.state
      }

      if (session.state === 'ACTIVE' || session.state === 'IN_PROGRESS') {
        hasStarted = true
      }

      if (session.updateTime !== lastUpdateTime) {
        const activities = await fetchAllActivities(fullSessionId)

        if (activities.length > lastSeenActivityIndex + 1) {
          for (let i = lastSeenActivityIndex + 1; i < activities.length; i++) {
            const act = activities[i]
            if (act.sessionCompleted) hasCompletedActivity = true
            if (act.sessionFailed) hasFailedActivity = true
            try {
              printActivity(i, act, fullSessionId, options)
            } catch (err) {
              console.error(`\x1b[31mError printing activity ${i}: ${err.message}\x1b[0m`)
            }
          }
          lastSeenActivityIndex = activities.length - 1
        }
        lastUpdateTime = session.updateTime
      }

      if (lastSeenActivityIndex > startIndex || (initialUpdateTime && session.updateTime !== initialUpdateTime)) {
        hasStarted = true
      }

      if (session.state === 'COMPLETED' || hasCompletedActivity) {
        console.error('\n\x1b[32m✔ Jules is done. Process exiting.\x1b[0m\n')
        process.exit(0)
      }

      if (session.state === 'FAILED' || session.state === 'CANCELLED' || hasFailedActivity) {
        console.error(`\n\x1b[31m❌ Session finished with state: ${session.state}\x1b[0m\n`)
        process.exit(1)
      }

      if (hasStarted && session.state === 'AWAITING_USER_INPUT') {
        console.error('\n\x1b[32m✔ Jules is done. Process exiting.\x1b[0m\n')
        process.exit(0)
      }
      currentPollInterval = basePollInterval
    } catch (err) {
      if (isRateLimitError(err)) {
        currentPollInterval = process.env.JULES_POLL_INTERVAL ? basePollInterval : Math.min(currentPollInterval * 2, 30000)
      }
      handlePollingError(err, 'send command')
    }
    await new Promise((resolve) => setTimeout(resolve, currentPollInterval))
  }
}

export function registerSendCommand (yargs) {
  return yargs.command(
    'send [message]',
    'Send a message to a session and tail until status is done/completed (supports stdin and @filepath)',
    (y) => {
      return y
        .positional('message', { type: 'string', describe: 'Message prompt to send' })
        .option('s', { alias: 'session', type: 'string', describe: 'Session ID to send message to' })
        .option('git-patch', { type: 'boolean', describe: 'Automatically apply received git patches to repository' })
    },
    async (argv) => {
      if (!argv.session) {
        console.error('\x1b[31m❌ Error: `--session` option is required for send command.\x1b[0m')
        process.exit(1)
      }
      let promptText = argv.message
      if (!promptText || promptText === '-') {
        promptText = await readStdin()
        promptText = promptText.trim()
      }
      if (!promptText) {
        console.error('\x1b[31m❌ Error: A message or stdin input is required for send command.\x1b[0m')
        process.exit(1)
      }
      try {
        promptText = expandAtFilepaths(promptText)
      } catch (err) {
        console.error(`\x1b[31m❌ Error reading file: ${err.message}\x1b[0m`)
        process.exit(1)
      }
      await sendMessageAndTail(argv.session, promptText, argv)
    }
  )
}
