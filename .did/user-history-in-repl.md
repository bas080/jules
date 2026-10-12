# Feature: Display User Prompt History in REPL

## Overview
Enable users in `jules repl` to view recent user messages they have submitted in the session (e.g. to inspect what they previously requested or queued).

## Detailed Requirements & Options

### Option 1: `/history` Slash Command (or `/sent`, `/prompts`)
Add a REPL slash command `/history [count]` (e.g. `/history 5`) that lists recent user messages:
```text
jules > /history
Recent Prompts Sent:
1. [10:12 AM] "Fix the race condition in createSession"
2. [10:14 AM] "Run npm test to verify all 65 tests pass"
```

### Option 2: Persistent History Header / Status Line
Display the last user prompt in a muted status header or above the prompt when Jules is thinking or active:
```text
Last prompt: "Run npm test to verify all 65 tests pass"
jules >
```

### Option 3: Command History Navigation via Arrow Keys (`readline`)
Ensure `readline` interface retains previous submitted prompts in `rl.history` so pressing the Up Arrow ($\uparrow$) cycles through previous sent prompts.

## Proposed Solution
Implement Option 1 (`/history` slash command) combined with Option 3 (`readline` history navigation).
