# Feature: Cross-Platform System Notifications when Jules becomes Idle / Awaits Input

## Status
Refine Stage (@bas080 #refine)

## Overview
When running `jules repl` or `jules tail` in the background (or in a separate terminal tab/window), users may switch to another application while waiting for Jules to finish executing tasks.

To keep users informed without requiring constant terminal polling, the CLI should send a cross-platform desktop notification (and optional terminal bell) whenever Jules transitions from `IN_PROGRESS`/`ACTIVE` to an idle state (`AWAITING_USER_INPUT`, `AWAITING_USER_FEEDBACK`, or `COMPLETED`).

## Cross-Platform Library Research

### 1. `node-notifier` (npm package)
- **Support**: macOS (Notification Center / `terminal-notifier`), Windows (Windows Toaster / Toast Notifications), Linux (`notify-send` / `dbus`), and WSL (`is-wsl`).
- **Features**:
  - Displays desktop toast notifications with title, message, icon/app name, and optional sound.
  - Zero external native C++ build compilation required (uses lightweight OS binaries/scripts).
- **Example Usage**:
  ```javascript
  import notifier from 'node-notifier'

  notifier.notify({
    title: 'Jules AI Session Ready',
    message: 'Jules is done and awaiting your input.',
    sound: true
  })
  ```

### 2. Terminal Bell (`\x07` / `BEL`)
- Sending `\x07` to stdout triggers a native terminal sound / dock bounce in terminal emulators (macOS Terminal, iTerm2, Windows Terminal, Alacritty).

## Proposed Requirements

### 1. Notification Trigger
Trigger a desktop notification when:
- Session state changes from `IN_PROGRESS` or `ACTIVE` to `AWAITING_USER_INPUT`, `AWAITING_USER_FEEDBACK`, or `COMPLETED`.
- A plan requires explicit user approval (`/approve`).

### 2. CLI Option & Environment Variable Configuration
- CLI flag: `--notify` / `--no-notify` (default: enabled or configurable)
- Environment variable: `JULES_NOTIFY="true"` (or `JULES_NOTIFY="false"` to disable)
- REPL slash command: `/notify [on|off]` to toggle notifications dynamically inside `jules repl`.

## Open Questions for @bas080
1. Should desktop notifications be enabled by default when `node-notifier` is installed, or opt-in via `--notify` / `JULES_NOTIFY=true`?
2. Should the notification include the session source/ID or last message summary in the title/body?
