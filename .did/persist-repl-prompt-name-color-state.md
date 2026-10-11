# Feature: Per-Session REPL State Persistence (Name, Color, Queue)

## Overview
Ensure `jules repl` remembers the custom prompt name (`/rename <name>`), prompt color (`/color <color>`), and queued message queue for each specific session across process restarts.

## Implementation Details
1. Store session configuration in `~/.jules-cache/sessions/<cleanSessionId>.json` containing `{ name, color, queue }`.
2. Automatically restore prompt name label, prompt color, and message queue on session start or reconnection.
3. Automatically update state file when `/rename`, `/color`, `/edit`, `/flush`, or message queue changes occur.
