import { fetchSessions, apiRequest } from '../common.js'

export async function archiveSession (sessionId) {
  return await apiRequest(`${sessionId}:archive`, 'POST')
}

export async function cleanup () {
  console.error('\x1b[36mRunning session cleanup...\x1b[0m\n')
  try {
    const sessions = await fetchSessions()
    if (sessions.length === 0) {
      console.error('No sessions found to clean up.')
      return
    }

    const oneWeekAgo = new Date()
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)

    let archivedCount = 0

    for (const session of sessions) {
      const sessionId = session.name || session.id
      const createTimeStr = session.createTime

      if (!createTimeStr) continue

      const createTime = new Date(createTimeStr)

      if (createTime < oneWeekAgo && session.state !== 'ARCHIVED') {
        console.error(`Archiving old session: ${sessionId} (Created: ${createTimeStr})`)
        try {
          await archiveSession(sessionId)
          archivedCount++
        } catch (err) {
          console.error(`\x1b[31mFailed to archive session ${sessionId}: ${err.message}\x1b[0m`)
        }
      }
    }

    console.error(`\n\x1b[32mCleanup complete. Archived ${archivedCount} old session(s).\x1b[0m`)
  } catch (err) {
    console.error(`\x1b[31m❌ Error during cleanup: ${err.message}\x1b[0m`)
    process.exit(1)
  }
}

export function registerCleanupCommand (yargs) {
  return yargs.command(
    'cleanup',
    'Archive sessions older than one week',
    {},
    async () => {
      await cleanup()
    }
  )
}
