import { fetchSources, renderMarkdown } from '../common.js'

export async function listSources () {
  console.error('\x1b[36mFetching sources...\x1b[0m\n')
  try {
    const sources = await fetchSources()
    if (sources.length === 0) {
      console.error('No sources found.')
      return
    }

    let table = '| Source Name | GitHub Repo | Default Branch |\n'
    table += '| --- | --- | --- |\n'

    sources.forEach((s) => {
      const name = s.name || s.id || 'unknown'
      const repo = s.githubRepo
        ? `${s.githubRepo.owner}/${s.githubRepo.repo}`
        : 'N/A'
      let branch = 'N/A'
      if (s.githubRepo && s.githubRepo.defaultBranch) {
        branch = typeof s.githubRepo.defaultBranch === 'object'
          ? s.githubRepo.defaultBranch.displayName || s.githubRepo.defaultBranch.name || 'N/A'
          : s.githubRepo.defaultBranch
      }

      table += `| ${name} | ${repo} | ${branch} |\n`
    })

    console.log(`\n${renderMarkdown(table)}\n`)
  } catch (err) {
    console.error(`\x1b[31m❌ Error fetching sources: ${err.message}\x1b[0m`)
    process.exit(1)
  }
}

export function registerSourcesCommand (yargs) {
  return yargs.command(
    'sources',
    'List available code sources (repositories)',
    {},
    async () => {
      await listSources()
    }
  )
}
