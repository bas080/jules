# Specification: Yargs CLI & Slash-Command Architecture

## Overview
Framework selection and slash-command parsing research for `jules`.

## Decision Summary
- **Selected Framework**: `yargs` (selected over `subcommander` and `commander`).
- **Explicit Command Registration**: `yargs.commandDir()` is explicitly **rejected**; all commands must be defined explicitly and imperatively in code for clarity and maintainability.

## Research: Parsing Slash Commands with Yargs (`/command <args>...`)

### Feasibility: **Yes, Fully Supported**
Yargs can parse slash-prefixed commands (`/upload`, `/color`, `/approve`, `/rename`, `/edit`, `/flush`, `/queue`, `/help`) along with positional arguments and flags.

### Technical Implementation Pattern:
1. **Command Signatures**:
   Yargs permits leading slashes in command names:
   ```javascript
   yargs
     .command('/color <color>', 'Change prompt color', (yargs) => {
       yargs.positional('color', { type: 'string', choices: ['green', 'cyan', 'blue', 'yellow', 'magenta', 'red', 'white', 'default'] })
     }, (argv) => {
       setPromptColor(argv.color);
     })
     .command('/upload <filepath>', 'Upload local text file', (yargs) => {
       yargs.positional('filepath', { type: 'string', demandOption: true })
     }, (argv) => {
       uploadFile(argv.filepath);
     });
   ```

2. **Parsing Strings**:
   Passing REPL line input directly to `yargs.parse(line)` or `yargs.parse(yargs-parser(line))` returns parsed `argv` with positional arguments and options:
   ```javascript
   const argv = yargs().parse('/upload --file foo.txt bar.js');
   // argv._ => ['/upload', 'bar.js']
   // argv.file => 'foo.txt'
   ```

3. **Advantages**:
   - Eliminates custom string splitting and manual argument validation for REPL slash commands.
   - Provides consistent option/flag parsing (`--flag`, `-f`, `--key=value`) across both CLI and REPL shells.
