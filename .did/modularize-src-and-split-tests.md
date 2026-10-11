# Refactor: Modularize Source into `src/` & Split Unit/Integration Tests

## Overview
Restructure `./jules` codebase into modular source files under `src/` and split tests into `test/unit/` and `test/integration/`.

## Implementation Details
1. **Source Organization**:
   - `src/common.js`: Shared utility functions, API request handling, markdown rendering, session state persistence.
   - `src/commands/`: Subcommand modules (`sessions.js`, `sources.js`, `cleanup.js`, `create.js`, `tail.js`, `repl.js`, `approve.js`, `send.js`).
   - `src/cli.js`: Yargs CLI entrypoint registering all subcommands.
   - `src/interdiff.mjs`: Multi-file interdiff computation.
2. **Test Organization**:
   - `test/unit/`: Unit tests (`interdiff.test.mjs`, `interdiff-real-repo.test.mjs`).
   - `test/integration/`: Integration tests (`cli.test.js`).
   - `package.json`: Added `test:unit` and `test:integration` scripts.
