import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { registerSessionsCommand } from './commands/sessions.js'
import { registerSourcesCommand } from './commands/sources.js'
import { registerCleanupCommand } from './commands/cleanup.js'
import { registerCreateCommand } from './commands/create.js'
import { registerTailCommand } from './commands/tail.js'
import { registerReplCommand } from './commands/repl.js'
import { registerApproveCommand } from './commands/approve.js'
import { registerSendCommand } from './commands/send.js'
import { fetchSessions, apiRequest, fetchAllActivities, openUrlInBrowser, log, API_KEY } from './common.js'

export async function runCli (argv = process.argv) {
  const args = hideBin(argv)
  const isHelpOrVersion = args.includes('--help') || args.includes('-h') || args.includes('--version') || args[0] === 'help'

  if (!API_KEY && !isHelpOrVersion) {
    console.error('\x1b[31m❌ Error: `JULES_API_KEY` environment variable is not set.\x1b[0m')
    process.exit(1)
  }

  const parser = yargs(args)
    .scriptName('jules')
    .usage('Jules CLI - AI Session Manager\n\nUsage: $0 <command> [options]')
    .env('JULES')
    .option('session', {
      alias: 's',
      type: 'string',
      describe: 'Session ID to target or operate on (env: JULES_SESSION)'
    })
    .option('source', {
      type: 'string',
      describe: 'Link or filter by a specific code source (e.g. owner/repo or sources/...) (env: JULES_SOURCE)'
    })
    .option('api-key', {
      type: 'string',
      describe: 'API key for Google Jules API authentication (env: JULES_API_KEY)'
    })
    .option('api-url', {
      type: 'string',
      describe: 'Google Jules API endpoint URL (env: JULES_API_URL)'
    })
    .option('disable-cache', {
      type: 'boolean',
      describe: 'Bypass local response caching in ~/.jules-cache (env: JULES_DISABLE_CACHE)'
    })
    .option('poll-interval', {
      type: 'number',
      describe: 'Background polling delay in milliseconds (env: JULES_POLL_INTERVAL)'
    })

  registerSessionsCommand(parser)
  registerSourcesCommand(parser)
  registerCleanupCommand(parser)
  registerCreateCommand(parser)
  registerTailCommand(parser)
  registerReplCommand(parser)
  registerApproveCommand(parser)
  registerSendCommand(parser)

  parser.command(
    'pr',
    'Open the GitHub pull request generated for a session',
    {},
    async (argv) => {
      let targetSessionId = argv.session
      if (!targetSessionId) {
        try {
          const sessions = await fetchSessions()
          if (sessions.length === 0) {
            console.error('\x1b[31m❌ Error: No sessions found.\x1b[0m')
            process.exit(1)
          }
          targetSessionId = sessions[0].name || sessions[0].id
        } catch (err) {
          console.error(`\x1b[31m❌ Error fetching sessions: ${err.message}\x1b[0m`)
          process.exit(1)
        }
      }

      const fullSessionId = targetSessionId.startsWith('sessions/') ? targetSessionId : `sessions/${targetSessionId}`

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
        process.exit(1)
      }
    }
  )

  parser.command(
    'help [cmd]',
    'Show help for a command',
    (y) => y.positional('cmd', { type: 'string', describe: 'Subcommand to display help for' }),
    async (argv) => {
      if (argv.cmd) {
        return runCli([...process.argv.slice(0, 2), argv.cmd, '--help'])
      } else {
        return runCli([...process.argv.slice(0, 2), '--help'])
      }
    }
  )

  return parser.demandCommand(1, '').strictCommands().help().parse()
}
