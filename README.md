# Project Jules

Jules is a toolset for interacting with the Jules API (`https://jules.googleapis.com/v1alpha`), designed to manage and monitor AI-driven sessions. The primary interface is a Node.js CLI that allows users to list, tail, and interact with sessions in real-time.

## CLI Tool (`./jules`)

The `jules` executable is the main entry point for session management. It interacts with the `v1alpha` version of the Jules API.

### Prerequisites

- **Node.js**: v18 or higher.
- **Environment Variables**:
  - `JULES_API_KEY`: Required for authentication with the Jules API.
  - `JULES_DISABLE_CACHE`: Set to `true` or `1` to bypass API response caching.

### Usage

```bash
export JULES_API_KEY="your_api_key_here"
./jules <command> [arguments]
```

### Commands

| Command | Arguments / Options | Description |
| :--- | :--- | :--- |
| `sessions` | None | Fetches and displays all available AI sessions in a formatted table (ID, State, Created). |
| `sources` | None | Lists all available code sources (repositories) registered with the API (Source Name, GitHub Repo, Default Branch). |
| `cleanup` | None | Archives sessions older than 7 days. |
| `create "prompt"` | `prompt` (required)<br>`--source <sourceId>` (optional) | Starts a new session with an initial prompt. The optional `--source` flag links the session to a repository (supports source names or short `owner/repo` formats). Once created, automatically starts the REPL for the new session. |
| `tail <sessionId>` | `sessionId` (optional) | Continuously polls and streams session state changes and activities. If no `sessionId` is provided, it defaults to the latest session. |
| `repl <sessionId>` | `sessionId` (optional) | Launches an interactive REPL shell to send messages to a session while streaming activity updates in real-time. Defaults to the latest session if no ID is specified. |

### Examples

#### 1. List Available Sessions and Sources

```bash
./jules sessions
./jules sources
```

#### 2. Create a Session and Enter REPL

```bash
./jules create "Fix typo in authentication handler" --source bas080/jules
```

#### 3. Tail an Active Session

```bash
./jules tail sessions/14335900485077787419
```

#### 4. Interactive REPL Chat

```bash
./jules repl sessions/14335900485077787419
```

### Key Implementations

#### Activity Rendering
To make output human-readable in the terminal, the CLI formats session activities using:
- **Markdown Rendering**: `marked` and `marked-terminal` format agent and user messages as styled terminal text.
- **Originator Highlighting**:
  - `AGENT`: Displayed in blue.
  - `USER`: Displayed in green.
  - Other originators: Displayed in magenta.
- **Specialized Activity Renderers**:
  - **Plans**: Displays generated plans as a numbered list with titles and step descriptions.
  - **Status Updates**: Highlights plan approvals, session completion, or session failure reasons.
  - **Artifacts**:
    - Git patches (`unidiffPatch`) printed as plain diff text.
    - Bash execution logs formatted with command, output, and exit code.

#### Caching & Performance
- **Persistent Cache**: Uses `node-fetch-cache` with `FileSystemCache` in `.jules-cache` to reduce redundant GET requests.
- **Cache Bypass**: Setting `JULES_DISABLE_CACHE=true` or `JULES_DISABLE_CACHE=1` bypasses cached responses. Commands fetching active session state or tailing activities automatically bypass the cache for real-time accuracy.
- **Polling Loop**: `tail` and `repl` commands poll session updates every 3 seconds to log new activities as they arrive.

## Technical Stack

- **Runtime**: Node.js (ES Modules)
- **API**: REST (`https://jules.googleapis.com/v1alpha`)
- **Dependencies**:
  - `marked`: Markdown parsing.
  - `marked-terminal`: Terminal markdown styling.
  - `node-fetch-cache`: Response caching.
  - `debug`: Logging.
