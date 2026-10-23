# Feature: Improve Headless Scripting Experience (Non-Interactive CLI Usage)

## Status
Refine Stage (@bas080 #refine)

## Overview
Currently, the Jules CLI (`./jules`) provides interactive REPL (`jules repl`) and streaming tail (`jules tail`) interfaces. However, users increasingly want to integrate Jules into automated scripts, CI/CD pipelines, git pre-commit hooks, and unattended background workflows.

To support seamless headless usage in scripts without human intervention or interactive REPL prompts, the CLI needs a dedicated non-interactive/scriptable interface and output formatting options.

## Requirements & Scope

### 1. Headless Non-Interactive Flag (`--headless` / `--batch` / `--no-interactive`)
- Introduce a top-level or command-level flag (e.g. `--headless` or `--batch`) that disables all interactive prompts, stdin reading, readline UI, and REPL launching.
- When running `jules send`, `jules create`, or `jules tail` headlessly:
  - Automatically approve or bypass interactive prompts if configured via options.
  - Terminate immediately with a clean exit code once the requested operation or target status is reached.

### 2. Machine-Readable Output Formats (`--json` & `--quiet`)
- `--json`: Output raw JSON objects or structured activity arrays to `stdout` so scripts can parse outputs using `jq` or Node.js scripts.
- `--quiet` (`-q`): Suppress headers, ASCII status icons, colors, and progress logs; print only the final patch, output message, or session ID.
- Ensure all logging/diagnostic output is written strictly to `stderr` so `stdout` remains clean for pipe redirection (e.g. `jules send "Fix bug" | git apply`).

### 3. Scriptable Exit Codes
Map process exit codes to session lifecycle states so bash scripts can perform conditional logic:
- `0`: Session completed successfully / plan executed / message delivered.
- `1`: Error encountered (API error, invalid parameters, network failure).
- `2`: Session failed (`sessionFailed`).
- `3`: Session timed out or requires human feedback (`AWAITING_USER_FEEDBACK`).

### 4. Direct Patch Output and Piping
- Add option `--stdout-patch` / `--patch-only` to stream the generated unified diff patch directly to stdout for piping:
  ```bash
  jules send "Fix typo in auth handler" --session 123 --patch-only | git apply
  ```

## Open Questions for @bas080
1. Should `jules send` in headless mode default to waiting/tailing until completion (`COMPLETED`/`FAILED`), or support an asynchronous `--async`/`--detach` flag?
2. Should auto-approval of generated plans in headless mode require explicit `--auto-approve-plan` flag, or inherit the default `--plan-approval=false` setting?
