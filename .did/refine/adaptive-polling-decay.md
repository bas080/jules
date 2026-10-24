# Feature: Adaptive Polling Decay Strategy for REPL Background Loop

## Status
Refine Stage (@bas080 #refine)

## Overview
Background polling in `jules repl` should never stop completely so that updates are continuously delivered to the user. To balance instant responsiveness with API server load:
1. When the user is actively interacting with the CLI or when Jules is working (`IN_PROGRESS`/`ACTIVE`), poll at high frequency (1 second interval).
2. As interaction cools down while Jules is idle, exponentially decay the polling frequency (e.g. 1s -> 1.5s -> 2.25s -> ... -> max 60s).
3. On any user keypress or submitted prompt, instantly reset polling frequency back to 1 second and trigger an immediate poll.

## Implementation Requirements

### 1. High-Frequency Active Polling (`minPollInterval = 1000ms`)
- Poll every 1000ms when user activity occurs on stdin or when session state is `IN_PROGRESS` or `ACTIVE`.

### 2. Adaptive Exponential Decay
- When user has not interacted for >10 seconds and session is idle (`AWAITING_USER_INPUT`, `AWAITING_USER_FEEDBACK`, `COMPLETED`, `FAILED`, `CANCELLED`):
  - Increase delay: `currentPollInterval = Math.min(60000, Math.round(currentPollInterval * 1.5))`
  - Cap maximum idle polling delay at 60 seconds (1 minute).

### 3. Immediate Interaction Reset
- Listening on `process.stdin` `data` events and `rl.on('line')` resets `currentPollInterval` to `minPollInterval` (1000ms), resets `lastUpdateTime = null`, and schedules `poll()` immediately (`setTimeout(poll, 0)`).

## Open Questions for @bas080
1. Should the active polling interval (1s) and maximum idle decay interval (60s) be exposed as user-configurable CLI options (e.g. `--poll-min` and `--poll-max`)?
