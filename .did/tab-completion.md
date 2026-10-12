# Feature: Tab Completion Support for Jules CLI & REPL

## Overview
Add shell tab completion (`jules completion`) for Bash/Zsh CLI subcommands, flags, and REPL slash commands.

## Exploration & Approaches

### Approach 1: Native Yargs Completion (`yargs.completion()`)
- **CLI Shell Completion**: Configure `.completion("completion", "Generate shell completion script")` in `src/cli.js`.
- **How it works**: Running `jules completion` outputs a completion script for `~/.bashrc` / `~/.zshrc`.
- **Dynamic Completions**: Yargs provides async completion callbacks `(current, argv, done) => ...` to dynamically autocomplete:
  - Subcommands (`sessions`, `sources`, `create`, `tail`, `repl`, `send`, `approve`, `cleanup`)
  - Flags (`--session`, `--source`, `--history`, `--git-pull`, `--git-patch`, `--name`)
  - Cached session IDs from `~/.jules-cache/sessions/`

### Approach 2: Readline Completer for Interactive REPL (`readline.createInterface({ completer })`)
- **REPL Tab Completion**: Provide a custom `completer(line)` function in `readline.createInterface`:
  ```javascript
  function completer (line) {
    const completions = ['/upload', '/approve', '/diff', '/rename', '/color', '/queue', '/edit', '/flush', '/clear', '/web', '/help']
    const hits = completions.filter(c => c.startsWith(line))
    return [hits.length ? hits : completions, line]
  }
  ```
- **How it works**: Pressing `<TAB>` in `jules repl` autocompletes slash commands (`/up<TAB>` -> `/upload`, `/di<TAB>` -> `/diff`) and local file paths for `/upload` or `@filepath`.

### Approach 3: Third-Party Shell Completion Generator (`omelette` or `tabtab`)
- **External CLI Completers**: Uses standalone completion packages (`omelette` / `tabtab`) to generate shell completion hooks.
- **Trade-off**: Requires an additional npm dependency versus native Yargs / Readline completers.

## Recommended Solution
Use **Approach 1** for CLI shell completions (`src/cli.js`) and **Approach 2** for in-REPL slash command completion (`src/commands/repl.js`). Both approaches use built-in features without external dependencies.
