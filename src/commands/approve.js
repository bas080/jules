import { apiRequest } from '../common.js'

export function registerApproveCommand (yargs) {
  return yargs.command(
    'approve',
    'Approve a generated plan for a session',
    (y) => {
      return y
    },
    async (argv) => {
      if (!argv.session) {
        console.error('\x1b[31m❌ Error: `--session` option is required for approve command.\x1b[0m')
        process.exit(1)
      }
      const fullSessionId = argv.session.startsWith('sessions/') ? argv.session : `sessions/${argv.session}`
      console.log(`\x1b[36mApproving plan for session:\x1b[0m ${fullSessionId}...`)
      await apiRequest(`${fullSessionId}:approvePlan`, 'POST', {})
      console.log('\x1b[32m✔ Plan approved successfully!\x1b[0m')
    }
  )
}
