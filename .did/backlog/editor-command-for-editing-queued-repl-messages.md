# Feature: Edit Queued REPL Messages in $EDITOR

## Overview
Implemented REPL command `/edit` that allows users to edit currently queued messages in `$EDITOR`.

## Implemented Design
1. **Separation Syntax**: Queued messages are separated with `---` blocks in the temporary file.
2. **Editor Requirement**: If `$EDITOR` is not defined in the environment, `/edit` displays an error explaining that `$EDITOR` must be set (e.g. `export EDITOR=vim`).
3. **Empty File Behavior**: Saving an empty file in `$EDITOR` clears the queue.
