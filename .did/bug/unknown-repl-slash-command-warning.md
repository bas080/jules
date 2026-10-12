# Bug: Unknown slash command in REPL should show a warning

## Symptoms
When a user types an unknown slash command (e.g. `/foo` or `/unknown`) in `jules repl`, the REPL currently treats it as a normal prompt message and sends it to the AI agent or queues it, rather than warning the user about the unknown command.

## Expected Behavior
When a line starts with `/` and does not match any recognized REPL slash command (`/upload`, `/approve`, `/diff`, `/rename`, `/color`, `/queue`, `/edit`, `/flush`, `/clear`, `/web`, `/help`), `jules repl` should display a clear warning message:
```text
⚠️ Warning: Unknown REPL command '/foo'. Type /help to list available commands.
```
and prompt the user again without sending the invalid command to the API.

## Solution
In `src/commands/repl.js` inside `rl.on('line')`, if `text.startsWith('/')` and does not match any valid slash command handler, output the warning and call `rl.prompt()`.
