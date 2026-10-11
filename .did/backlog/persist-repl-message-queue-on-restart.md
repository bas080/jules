# Feature: Persist REPL Message Queue Across Restart (Session Specific)

## Overview
Enable the `jules repl` shell to recover and restore queued messages specific to each Jules session ID (`sessionId`) when the REPL process restarts or connects to that session.

## Proposed Functionality
1. **Session-Specific Persistence**:
   - Save queued messages to a file keyed strictly by `sessionId` (e.g. `.jules-cache/queues/<cleanSessionId>.json`).
   - Whenever messages are queued, edited via `/edit`, or flushed in a REPL session, sync the persistence file for that specific `sessionId`.
2. **Auto-Recovery on Session Connect**:
   - When connecting to a session in `jules repl` (or switching sessions), load the persisted queue file for that specific `sessionId`.
   - Restore the session's queued messages into the REPL state and update the prompt queue counter ` [N]`.
3. **Session Queue Lifecycle**:
   - Clearing or flushing a session's message queue automatically deletes its session-specific persistence file.
