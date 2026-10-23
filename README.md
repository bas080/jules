# Project Jules

**Project Jules** is an open-source command-line interface (CLI) and interactive REPL client for [Google Jules](https://jules.google.com/), Google's AI-driven software engineering agent. It enables developers to create, monitor, and chat with AI coding sessions directly from their terminal without leaving their local workflow.

---

## Features

- 🚀 **Interactive REPL Shell**: Real-time terminal chat with streaming activity updates, status badges, and prompt customization.
- 📋 **Plan Approval & Execution**: Review and approve generated implementation plans (`/approve`).
- 📄 **Git Patch & Interdiff Support**: Preview git patches, inspect step-by-step interdiffs, and automatically apply patches locally (`--git-patch`).
- 📥 **Flexible Message Queueing**: Buffer prompts while Jules works and configure queue dispatch behavior (`bulk` vs `single`/one-by-one).
- ⚡ **Auto-Send on Idle**: Automatically send queued items when Jules reaches idle or `COMPLETED` state (`--auto-send` / `/autosend`).
- 🔔 **Desktop Notifications**: Cross-platform system notifications when Jules completes tasks or requires plan approval (`--notify`).
- 📂 **Local File Attachments**: Attach local source files directly into chat (`/upload <filepath>`).
- 🌐 **Browser Integration**: Direct links to open GitHub PRs (`jules pr` / `/pr`) or sessions on [jules.google.com](https://jules.google.com/) (`/web`).

---

## Installation & Setup

### Prerequisites

- **Node.js**: v18.0.0 or higher.
- **Google Jules API Key**: Set `JULES_API_KEY` in your environment.

### Getting Started

```bash
# Clone the repository
git clone https://github.com/bas080/jules.git
cd jules

# Install dependencies
npm install

# Export your API key
export JULES_API_KEY="your_jules_api_key"

# Run the CLI
./jules --help
```

---

## CLI Usage

```bash
./jules <command> [options]
```

### Commands

| Command | Arguments | Description |
| :--- | :--- | :--- |
| `sessions` | None | Lists available AI sessions in a terminal-formatted table. |
| `sources` | None | Lists registered code sources (repositories). |
| `create <prompt>` | `prompt` (required) | Starts a new session with an initial prompt and connects to REPL. |
| `repl [prompt]` | `prompt` (optional) | Launches the interactive REPL shell (defaults to latest session). |
| `tail [sessionId]` | `sessionId` (optional) | Live-streams session activity events without interactive input. |
| `send [message]` | `message` (optional) | Sends a message (or reads stdin) and tails until completion. |
| `approve` | None | Approves a generated plan for a session. |
| `pr` | None | Opens the session's generated GitHub pull request in default browser. |
| `cleanup` | None | Archives sessions older than 7 days. |
| `help [cmd]` | `cmd` (optional) | Displays CLI help for subcommands or top-level overview. |

---

## Interactive REPL Slash Commands

Inside `jules repl`, type `/` to access built-in slash commands:

| Command | Description |
| :--- | :--- |
| `/send [all\|one\|N]` | Send queued messages immediately (all in bulk, one by one, or specific index `N`). |
| `/flush` | Alias for `/send`. |
| `/queue [strategy]` | Inspect or update queue strategy (`direct`, `buffered`, `bulk`, `single`, `auto`, `manual`). |
| `/autosend [on\|off]` | Toggle auto-sending queued messages on idle. |
| `/new <msg>` | Start a new session for the same source and switch in-place. |
| `/upload <filepath>`| Attach and send local text file content into chat. |
| `/approve` | Approve the generated plan. |
| `/diff` | View latest git patch artifact and step interdiff. |
| `/status` | Render session status table dynamically scaled to terminal width. |
| `/pr` | Open generated GitHub pull request in browser. |
| `/web` | Open session page on [jules.google.com](https://jules.google.com/). |
| `/edit` | Edit queued messages in `$EDITOR`. |
| `/rename <name>` | Set a custom display name/label for the REPL prompt. |
| `/color <color>` | Change prompt background color (`green`, `cyan`, `blue`, `yellow`, `magenta`, `red`, `white`). |
| `/notify [on\|off]` | Toggle cross-platform desktop notifications. |
| `/history [count]` | List recent sent user prompts. |
| `/clear` | Clear terminal screen. |
| `/archive` | Archive current session and exit REPL. |
| `/help` | Display REPL command help menu. |

---

## Configuration & Environment Variables

| Flag | Environment Variable | Default | Description |
| :--- | :--- | :--- | :--- |
| `-s, --session` | `JULES_SESSION` | Latest session | Session ID to target or operate on. |
| `--source` | `JULES_SOURCE` | None | Repository source name or short `owner/repo`. |
| `--api-key` | `JULES_API_KEY` | None | API authentication key for Google Jules API. |
| `--api-url` | `JULES_API_URL` | `https://jules.googleapis.com/v1alpha` | Custom Jules API base URL. |
| `--queue-dispatch` | `JULES_QUEUE_DISPATCH` | `bulk` | Queue dispatch behavior (`bulk` or `single`). |
| `--queue-mode` | `JULES_QUEUE_MODE` | `direct` | Queue mode (`direct` or `buffered`). |
| `--auto-send` | `JULES_AUTO_SEND` | `true` | Automatically send queued messages when Jules is idle. |
| `--notify` | `JULES_NOTIFY` | `true` | Send desktop notifications on status transitions. |
| `--disable-cache` | `JULES_DISABLE_CACHE` | `false` | Bypass local HTTP response caching in `~/.jules-cache`. |
| `--poll-interval` | `JULES_POLL_INTERVAL` | `3000` | Background polling interval in milliseconds. |

---

## Examples

### 1. Create a Session & Start Chatting

```bash
./jules create "Fix authentication middleware bug" --source bas080/jules
```

### 2. Launch REPL with Single Queue Dispatch Mode

```bash
./jules repl --queue-dispatch=single --source bas080/jules
```

### 3. Send Message Headlessly in Scripts

```bash
./jules send "Run tests and refactor auth logic" -s sessions/123456789
```

---

## License

ISC License.
