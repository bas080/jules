# Feature: Persist REPL Message Queue Across Restart

## Overview
Enable the `jules repl` shell to recover and restore queued messages when the REPL process restarts or exits unexpectedly.

## Proposed Functionality
1. **Queue File Persistence**:
   - Write queued messages to a session-specific persistence file in `.jules-cache/queues/<sessionId>.json` or temporary file whenever messages are added, edited, or flushed.
2. **Auto-Recovery on Startup**:
   - Upon connecting to a session in `jules repl`, check if a persisted queue file exists for that session.
   - Restore non-empty queue messages into memory and update the prompt label count ` [N]`.
3. **Queue Cleanup**:
   - When the queue is flushed or cleared, delete or empty the session's persisted queue file.
