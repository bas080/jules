import { fetchSessions, listSessionsFromList } from '../common.js'

export async function listSessions () {
  console.error('\x1b[36mFetching sessions...\x1b[0m\n')
  try {
    const sessions = await fetchSessions()
    if (sessions.length === 0) {
      console.error('No sessions found.')
      return
    }
    listSessionsFromList(sessions)
  } catch (err) {
    console.error(`\x1b[31m❌ Error fetching sessions: ${err.message}\x1b[0m`)
    process.exit(1)
  }
}

export function registerSessionsCommand (yargs) {
  return yargs.command(
    'sessions',
    'List all available AI sessions',
    {},
    async () => {
      await listSessions()
    }
  )
}
