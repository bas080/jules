# Feature: Edit Queued REPL Messages in $EDITOR

## Overview
Add a REPL command (e.g., `/edit`) that allows the user to open their currently queued messages in their system editor (`$EDITOR` or `vi`/`nano`) to refine or modify them before flushing or auto-sending.

## Proposed Functionality
1. **Command Execution**:
   - Running `/edit` in the REPL dumps all currently queued messages into a temporary file and opens `$EDITOR`.
   - Upon exiting the editor, the contents of the temporary file are parsed and replace the current message queue.
2. **Questions for `@bas080`**:
   - Should `/edit` open all queued messages concatenated with `---` separators in a single file buffer, or should each queued message be presented individually?
   - What fallback editor should be selected if `$EDITOR` is not defined in the environment (e.g. `vi`, `nano`, `notepad`)?
   - Should saving an empty file in `$EDITOR` clear/cancel all queued messages?
