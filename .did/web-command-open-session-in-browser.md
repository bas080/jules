# Feature: REPL `/web` Command to Open Session in Browser

## Overview
Add a `/web` slash command in `jules repl` that opens the current session in the default system browser at `https://jules.google.com/session/<cleanSessionId>`.

## Implementation Details
1. Formats session URL as `https://jules.google.com/session/<sessionId>` with `sessions/` prefix stripped.
2. Invokes system browser launcher (`open` on macOS, `xdg-open` on Linux, `start` on Windows).
3. Updated REPL `/help` output to list `/web`.
