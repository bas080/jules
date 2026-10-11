# Feature: Sending Local Client Files to Jules Sessions

## Status
Refine Stage (#refine)

## Overview
Enable CLI users to send local files (or code snippets) from their machine to a Jules session during `send`, `create`, or within an interactive `repl` session.

## Detailed Requirements & Syntax

### 1. `jules send` & `jules create` File Flag
- Add a `--file <filepath>` (or `-f <filepath>`) option to `jules send` and `jules create`.
- Multiple `--file` options can be passed:
  ```bash
  jules send "Fix bug in auth middleware" -s 123 --file ./src/auth.js --file ./test/auth.test.js
  ```
- The contents of specified local files will be appended to the user message prompt with clear markdown code fences and file paths.

### 2. Interactive REPL Commands
Support sending local files dynamically during an active REPL session:
- **Slash command syntax**:
  ```text
  jules > /file ./src/index.js Explain what this file does
  ```
- **At-mention syntax**:
  ```text
  jules > Please review @./src/index.js and @./package.json
  ```
  The CLI will parse `@<filepath>`, read the files from disk, and embed their contents into the outgoing prompt.

## Refinement Suggestions & Enhancements

1. **File Size & Binary Safeguards**:
   - Automatically ignore or warn on binary files (e.g. images, PDFs, compiled binaries).
   - Enforce a maximum file size limit (e.g. 500KB per file) to prevent exceeding Jules API payload limits.

2. **Wildcards / Globbing**:
   - Allow glob patterns like `--file "./src/**/*.js"` or `/file ./src/*.ts`.

3. **Auto-Context Insertion**:
   - Embed files with relative paths relative to current git repo root:
     ```markdown
     --- File: src/auth.js ---
     ```javascript
     // Content...
     ```
     ```
