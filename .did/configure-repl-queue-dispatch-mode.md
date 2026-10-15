# Feature: Configure REPL Message Queue Dispatch Behavior (Individual vs Bulk)

## Status
Refine Stage (@bas080 #refine)

## Overview
Currently, when Jules is busy (`IN_PROGRESS` / `ACTIVE`) and multiple user prompt messages are submitted in `jules repl`, they are held in a local queue and combined into a single prompt payload separated by `---` when flushed or dispatched (`/flush`).

Users should be able to configure whether queued REPL messages are sent all at once in bulk (current behavior) or dispatched individually one message at a time as Jules becomes ready (`AWAITING_USER_INPUT` / `COMPLETED`).

## Detailed Requirements

### 1. Configuration Option
- Add a configuration mode for REPL message queue dispatch:
  - **`bulk`** (Default): Flushes and combines all queued messages into a single prompt string separated by `\n\n---\n\n`.
  - **`single`** / **`individual`**: Dispatches only the first (oldest) queued message when Jules becomes ready, leaving remaining prompts in the queue to be dispatched sequentially after each task completes.

### 2. Interactive REPL Slash Command
- Add a slash command in `jules repl` to toggle or set the mode dynamically:
  - `/queue mode [bulk|single]` or `/queue dispatch [bulk|single]`
  - Example: `/queue mode single`
  - Output confirmation: `✔ REPL queue dispatch mode set to single (individual messages).`

### 3. CLI Option & Environment Variable
- Support setting the default queue dispatch mode via CLI flag and environment variable:
  - CLI flag: `--queue-dispatch <bulk|single>`
  - Environment variable: `JULES_QUEUE_DISPATCH="single"`

## Open Questions for @bas080
- Should `/flush` always force-send all queued messages in bulk regardless of the configured queue mode setting?
