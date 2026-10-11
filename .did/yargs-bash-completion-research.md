# Research: Yargs Shell & Bash Completion for Jules CLI

## Executive Summary
Yes, `yargs` has built-in, native support for generating shell completion scripts for **bash** and **zsh**. By adding `.completion("completion", "Generate shell completion script")` to the `yargs` parser in `src/cli.js`, running `jules completion` will output a complete bash completion script.

---

## 1. How Yargs Shell Completion Works

1. **Completion Script Generation**:
   When configured with `.completion("completion", ...)`, executing `jules completion` outputs a bash shell function (`_jules_yargs_completions`) registered via `complete -F _jules_yargs_completions jules`.

2. **Dynamic Query Handler**:
   When the user presses `<TAB>` in their terminal, bash calls:
   ```bash
   jules --get-yargs-completions <current_words...>
   ```
   `yargs` intercepts the hidden `--get-yargs-completions` flag, parses the partial command line, calculates matching subcommands, positional arguments, or flags, and outputs them line-by-line for bash autocomplete.

---

## 2. User Installation Instructions

To enable tab-completion in bash or zsh, users can simply run:

### For Bash (`~/.bashrc` or `~/.bash_profile`):
```bash
jules completion >> ~/.bashrc
source ~/.bashrc
```

### For System-wide Bash Completions:
```bash
jules completion | sudo tee /etc/bash_completion.d/jules > /dev/null
```

---

## 3. Prototype Benchmark & Test Results

A test prototype was executed using `yargs` in Node.js:

```javascript
import yargs from "yargs";

const parser = yargs()
  .scriptName("jules")
  .command("sessions", "List all available AI sessions")
  .command("sources", "List available code sources")
  .command("create <prompt>", "Start a new session")
  .command("tail [sessionId]", "Live-stream session activities")
  .command("repl [sessionIdOrPrompt]", "Interactive REPL shell")
  .command("send [message]", "Send message to session")
  .command("approve", "Approve generated plan")
  .command("cleanup", "Archive old sessions")
  .completion("completion", "Generate shell completion script");

// Test output generation
parser.parse("completion", (err, argv, output) => {
  console.log(output);
});
```

### Test Output Analysis
Running `jules completion` generates the following bash script:

```bash
###-begin-jules-completions-###
#
# yargs command completion script
#
# Installation: jules completion >> ~/.bashrc
#    or jules completion >> ~/.bash_profile on OSX.
#
_jules_yargs_completions()
{
    local cur_word args type_list

    cur_word="${COMP_WORDS[COMP_CWORD]}"
    args=("${COMP_WORDS[@]}")

    mapfile -t type_list < <(jules --get-yargs-completions "${args[@]}")

    COMPREPLY=( $(compgen -W "${type_list[*]}" -- "$cur_word") )

    if [ ${#COMPREPLY[@]} -eq 0 ]; then
      declare -F _filedir &>/dev/null && _filedir
    fi
    return 0
}
complete -o default -F _jules_yargs_completions jules
###-end-jules-completions-###
```

---

## 4. Advanced Dynamic Completions

`yargs` also supports passing a custom async completion callback `(current, argv, done) => ...` to provide intelligent, context-aware autocompletion:

1. **Autocomplete Flags**: Suggest `--session`, `--source`, `--history`, `--git-pull`, `--git-patch`, etc. when `current` starts with `-`.
2. **Autocomplete Session IDs**: Read cached session IDs from `~/.jules-cache/` to autocomplete session names when typing `jules tail <TAB>` or `jules repl <TAB>`.

### Example Custom Completion Callback:
```javascript
parser.completion("completion", "Generate shell completion script", (current, argv, done) => {
  if (current.startsWith("-")) {
    done(["--session", "--source", "--name", "--history", "--git-pull", "--git-patch"]);
  } else {
    done(["sessions", "sources", "cleanup", "create", "tail", "repl", "approve", "send"]);
  }
});
```

---

## 5. Implementation Recommendation for `./jules`

To enable this feature in `./jules`:

In `src/cli.js`:
```javascript
  parser.completion("completion", "Generate shell completion script");
```

This single line gives users out-of-the-box shell autocompletion for all `jules` subcommands, arguments, and flags!
