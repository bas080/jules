# Feature: Configure REPL Queue-First Mode and Message Queue Dispatch Behavior (Individual vs Bulk)

## Status
Refine Stage (@bas080 #refine)

## Overview
Currently, when Jules is idle (`AWAITING_USER_INPUT`), typing a prompt in `jules repl` sends the message immediately to the API. When Jules is busy (`IN_PROGRESS` / `ACTIVE`), submitted messages are placed into a local queue. When the queue is dispatched, all messages are combined into a single prompt payload separated by `\n\n---\n\n`.

Users want to configure two key aspects of REPL queueing:
1. **Queue-First / Buffer Mode**: Option to always write incoming user prompts directly to the local queue first (even when Jules is idle) rather than sending immediately on `[Enter]`. The user then decides when to flush/dispatch.
2. **Dispatch Mode (Individual vs Bulk)**: Option to configure whether queued messages are dispatched one at a time sequentially as Jules finishes each task, or sent all together in bulk as a single combined payload.

## Detailed Requirements

### 1. Renamed Command: `/send <all|one>` (formerly `/flush`)
- Rename `/flush` (and `/now`) slash command in `jules repl` to `/send`.
- `/send` takes a required argument: `all` or `one`:
  - `/send all`: Flushes and combines all currently queued messages into a single prompt payload separated by `\n\n---\n\n`.
  - `/send one`: Dispatches only the first (oldest) queued message immediately, keeping the remaining messages in the queue.

### 2. Slash Command `/queue [strategy]`
- `/queue` takes an optional argument to view or update the queue strategy dynamically:
  - Running `/queue` with no arguments lists currently queued messages (existing behavior).
  - `/queue <strategy>` sets the queueing / dispatch strategy:
    - `/queue direct`: Default behavior (sends immediately if idle, queues if busy).
    - `/queue buffered` / `/queue first`: Always writes user prompts to the local queue first without auto-sending.
    - `/queue bulk`: Auto-dispatches all queued messages together when Jules becomes ready.
    - `/queue single` / `/queue one`: Auto-dispatches queued messages one at a time sequentially as Jules becomes ready.

### 3. CLI Option & Environment Variable
- Support setting the default queue dispatch mode via CLI flag and environment variable:
  - CLI flag: `--queue-dispatch <bulk|single>`
  - Environment variable: `JULES_QUEUE_DISPATCH="single"`

## Open Questions for @bas080
- Should `/flush` always force-send all queued messages in bulk regardless of the configured queue mode setting?
