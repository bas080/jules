import { fetchSessions, apiRequest, fetchAllActivities, printActivity, isRateLimitError, handlePollingError, sendDesktopNotification, formatSourceDisplay } from '../common.js'

export async function tail (sessionId, options = {}) {
  const fullSessionId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`
  console.error(`\x1b[36mTailing session:\x1b[0m ${fullSessionId}...\n`)

  let lastSeenActivityIndex = -1
  let lastState = null
  let lastUpdateTime = null

  const basePollInterval = process.env.JULES_POLL_INTERVAL ? parseInt(process.env.JULES_POLL_INTERVAL, 10) : 3000
  let currentPollInterval = basePollInterval

  while (true) {
    try {
      const session = await apiRequest(fullSessionId, 'GET', null, true)

      if (session.state !== lastState) {
        process.stderr.write(`\n\x1b[33m[${new Date().toLocaleTimeString()}] State: ${session.state}\x1b[0m\n`)
        const wasWorking = (lastState === 'IN_PROGRESS' || lastState === 'ACTIVE')
        lastState = session.state
        if (wasWorking && (session.state === 'AWAITING_USER_INPUT' || session.state === 'AWAITING_USER_FEEDBACK' || session.state === 'COMPLETED')) {
          const sessionLabel = formatSourceDisplay(session.sourceContext || session.source) || fullSessionId.replace(/^sessions\//, '')
          sendDesktopNotification(
            `Jules AI (${sessionLabel})`,
            `Jules is now ${session.state.toLowerCase().replace(/_/g, ' ')}.`,
            options
          )
        }
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
              console.error(`\x1b[31mError printing activity ${i}: ${err.message}\x1b[0m`)
            }
          }
          lastSeenActivityIndex = activities.length - 1
        }
        lastUpdateTime = session.updateTime
      }
      currentPollInterval = basePollInterval
    } catch (err) {
      if (isRateLimitError(err)) {
        currentPollInterval = process.env.JULES_POLL_INTERVAL ? basePollInterval : Math.min(currentPollInterval * 2, 30000)
      }
      handlePollingError(err, 'tail command')
    }
    await new Promise((resolve) => setTimeout(resolve, currentPollInterval))
  }
}

export function registerTailCommand (yargs) {
  return yargs.command(
    'tail [sessionId]',
    'Live-stream session activities (defaults to latest)',
    (y) => {
      return y
        .positional('sessionId', { type: 'string', describe: 'Session ID to tail' })
        .option('history', { type: 'boolean', describe: 'Fetch and print full activity history on startup' })
        .option('git-patch', { type: 'boolean', describe: 'Automatically apply received git patches to repository' })
        .option('notify', { type: 'boolean', default: true, describe: 'Send desktop notifications when Jules becomes idle or requires input' })
    },
    async (argv) => {
      let targetSessionId = argv.session || argv.sessionId
      if (!targetSessionId) {
        try {
          const sessions = await fetchSessions()
          if (sessions.length === 0) {
            console.error('\x1b[31m❌ Error: No sessions found to tail.\x1b[0m')
            process.exit(1)
          }
          targetSessionId = sessions[0].name || sessions[0].id
          console.log(`\x1b[90mNo session ID provided. Defaulting to latest: ${targetSessionId}\x1b[0m`)
        } catch (err) {
          console.error(`\x1b[31m❌ Error fetching latest session: ${err.message}\x1b[0m`)
          process.exit(1)
        }
      }
      await tail(targetSessionId, argv)
    }
  )
}
