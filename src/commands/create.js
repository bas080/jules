import { fetchSources, apiRequest, log, expandAtFilepaths } from '../common.js'
import { repl } from './repl.js'

export async function createSession (prompt, sourceId = null) {
  let finalSourceId = sourceId

  if (sourceId !== null && sourceId !== undefined) {
    if (typeof sourceId !== 'string' || !sourceId.trim() || sourceId === 'true' || sourceId === 'false') {
      throw new Error(`Invalid source parameter: '${sourceId}'. A valid source string (e.g. owner/repo or sources/...) is required when --source is specified.`)
    }

    log(`Attempting to resolve source ID: ${sourceId}`)
    try {
      const sources = await fetchSources()
      if (!sourceId.startsWith('sources/')) {
        const matchedSource = sources.find(s =>
          s.githubRepo && `${s.githubRepo.owner}/${s.githubRepo.repo}` === sourceId
        )
        if (matchedSource) {
          finalSourceId = matchedSource.name
          log(`Resolved ${sourceId} to ${finalSourceId}`)
        } else {
          throw new Error(`Source not found: ${sourceId}. Please use 'jules sources' to find a valid source name.`)
        }
      } else {
        const exists = sources.some(s => s.name === sourceId || s.id === sourceId)
        if (!exists && sources.length > 0) {
          throw new Error(`Source not found: ${sourceId}. Please use 'jules sources' to find a valid source name.`)
        }
      }
    } catch (err) {
      throw new Error(`Failed to resolve source: ${err.message}`)
    }
  }

  console.error('\x1b[36mCreating session...')
  const body = { prompt }
  if (finalSourceId) {
    body.sourceContext = finalSourceId
    console.error(`\x1b[90mSource ID:\x1b[0m ${finalSourceId}`)
  }
  console.error(`\x1b[90mPrompt:\x1b[0m "${prompt}"`)

  const session = await apiRequest('sessions', 'POST', body)
  console.error(`\x1b[32mSession created successfully!\x1b[0m ID: ${session.name}`)
  return session.name
}

export function registerCreateCommand (yargs) {
  return yargs.command(
    'create <prompt>',
    'Start a new session with an initial prompt (supports @filepath)',
    (y) => {
      return y
        .positional('prompt', { type: 'string', describe: 'Initial prompt for the session' })
        .option('source', { type: 'string', describe: 'Link the session to a specific code source' })
    },
    async (argv) => {
      let finalPrompt = argv.prompt
      try {
        finalPrompt = expandAtFilepaths(argv.prompt)
      } catch (err) {
        console.error(`\x1b[31m❌ Error reading file: ${err.message}\x1b[0m`)
        process.exit(1)
      }
      const newSessionId = await createSession(finalPrompt, argv.source)
      await repl(newSessionId)
    }
  )
}
