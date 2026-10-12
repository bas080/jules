# Bug: REPL freezes when resumed from background (`Ctrl+Z` then `fg`)

## Symptoms
When running `jules repl`, suspending the process with `Ctrl+Z` (`SIGTSTP`), and resuming it in the terminal with `fg` (`SIGCONT`), the REPL prompt stops responding to keyboard input or freezes.

## Root Cause
When the process is suspended and resumed with `SIGCONT`, Node.js `readline` interface and `process.stdin` TTY mode can remain paused or unprompted.

## Solution
Register a `SIGCONT` signal handler in `repl()` in `src/commands/repl.js`:
```javascript
process.on('SIGCONT', () => {
  process.stdin.resume()
  rl.prompt(true)
})
```
This ensures `process.stdin` is resumed and the readline prompt is refreshed immediately when brought back to the foreground.
