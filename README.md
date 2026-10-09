# `jules-runner.mjs`

A CLI utility for queueing, parsing, and sequentially dispatching tasks to the **Google Jules API** via standard input (`stdin`).

`jules-runner.mjs` allows you to pipe Markdown task lists, plain-text prompts, or issue backlogs directly into an active Jules session while automatically managing session state, polling for completion, and handling session auto-unpausing.

## Features

### 1. Multi-Strategy Markdown Task Parser

Parses input from `stdin` and automatically selects the optimal splitting strategy based on structure:

* **Horizontal Dividers (`---` or `***`)**: Splits multi-line blocks containing code blocks, tables, or complex lists.
* **Markdown Headings (`#`, `##`, `###`)**: Splits document sections into separate tasks using headers.
* **Lists & Checkboxes**: Extracts individual tasks from Markdown bullet points (`-`, `*`, `+`), numbered lists (`1.`), or task checkboxes (`[ ]`, `[x]`).
* **Plain Text Fallback**: Handles raw text and string redirects (e.g., `<<< 'Check that README was rebranded'`).

### 2. Session Lifecycle & State Management

* **Idle Validation**: Checks that the session is in a valid state (`WAITING_FOR_USER_INPUT`, `AWAITING_APPROVAL`, `COMPLETED`) before attempting to dispatch a prompt.
* **Task Pickup & Completion Monitoring**: Polls the session state after dispatching a prompt to ensure the task is picked up (transitions to `PLANNING`/`EXECUTING`) and blocks until the turn completes.
* **Auto-Unpause Handling**: Detects if the session enters a `PAUSED` state at any point during polling and automatically sends an `:unpause` request to resume task execution seamlessly.

### 3. Machine-Readable & Friendly Markdown Logs

Outputs real-time execution progress in standard Markdown.

* Structured headings (`#`, `##`, `###`) for CI log parsers.
* Blockquotes (`>`) to isolate user prompts.
* Key-value metadata lists (`- **Session ID**: ...`) for simple regex extraction.

### 4. Safe Dry-Run Mode

Simulates the execution plan without making API calls if no session ID is supplied or when passed the `--dry-run` flag.

## Prerequisites

* **Node.js** (v18 or higher for native `fetch` support)
* **Jules API Key** configured as an environment variable

## Installation

1. Save the script locally and make it executable:
```bash
chmod +x jules-runner.mjs

```


2. Set your Google Jules API Key:
```bash
export JULES_API_KEY="your_api_key_here"

```

## Usage

### Syntax

```bash
<input-source> | ./jules-runner.mjs [sessions/<session_id> | <session_id>] [--dry-run]

```

### Examples

#### 1. Piping a Markdown Backlog File

```bash
cat backlog.md | ./jules-runner.mjs 6246523458488920156

```

#### 2. Single Task String Pipe

```bash
./jules-runner.mjs 6246523458488920156 <<< "Fix typo in login route and update README"

```

#### 3. Previewing Task Parsing (Dry-Run Mode)

Omit the session ID or add `--dry-run`:

```bash
cat backlog.md | ./jules-runner.mjs
# OR
cat backlog.md | ./jules-runner.mjs 6246523458488920156 --dry-run

```

## Supported Task Formats

The script accepts any of the following input structures in `stdin`:

#### Dividers (`---`)

```markdown
Fix the user authentication route.
---
Add unit tests for `/login`.
Include edge cases for empty passwords.
---
Update API documentation.

```

#### Headings (`##`)

```markdown
## Task 1: Refactor Database Pool
Optimize connection pool size for high concurrency.

## Task 2: Add Logging
Include request ID in output logs.

```

#### Bullet Lists & Checkboxes

```markdown
- [ ] Fix typo in README
- [ ] Add input validation on user profile form
* [x] Update dependencies in package.json
1. Deploy staging build

```

## State Diagram

```
[ Input stdin ] ---> [ Parse Markdown Strategy ]
                            │
                            ▼
              [ Wait for Session Idle ] <──────┐
                            │                  │
               (If PAUSED)  ├──> [ Auto-Unpause ]
                            │
                            ▼
                [ Send Prompt via API ]
                            │
                            ▼
            [ Wait for Task Pickup & Finish ]
                            │
                            ▼
                 [ Next Task / Summary ]

```
