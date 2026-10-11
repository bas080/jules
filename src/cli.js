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
import { API_KEY } from './common.js'

export async function runCli (argv = process.argv) {
  const args = hideBin(argv)
  const isHelpOrVersion = args.includes('--help') || args.includes('-h') || args.includes('--version')

  if (!API_KEY && !isHelpOrVersion) {
    console.error('\x1b[31m❌ Error: `JULES_API_KEY` environment variable is not set.\x1b[0m')
    process.exit(1)
  }

  const parser = yargs(args)
    .scriptName('jules')
    .usage('Jules CLI - AI Session Manager\n\nUsage: $0 <command> [options]')

  registerSessionsCommand(parser)
  registerSourcesCommand(parser)
  registerCleanupCommand(parser)
  registerCreateCommand(parser)
  registerTailCommand(parser)
  registerReplCommand(parser)
  registerApproveCommand(parser)
  registerSendCommand(parser)

  return parser.demandCommand(1, '').strict().help().parse()
}
