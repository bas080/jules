# Project Jules

Jules is a toolset for interacting with the Jules API, designed to manage and monitor AI-driven sessions. The primary interface is a Node.js CLI that allows users to list, tail, and interact with sessions in real-time.

## CLI Tool (`./jules`)

The `jules` executable is the main entry point for session management. It interacts with the `v1alpha` version of the Jules API.

### Commands

| Command | Arguments | Description |
| :--- | :--- | :--- |
| `sessions` | None | Fetches and displays all available sessions, including their ID, current state, and creation time. |
| `sources` | None | Lists all available code sources (repositories) registered with the API. |
| `cleanup` | None | Archives sessions older than one week. |
| `create "prompt"` | `prompt` (required) | Creates a new session with an initial prompt. Supports optional `--source <sourceId>` to link to a repository. |
| `tail <sessionId>` | `sessionId` (optional) | Continuously polls the API for a specific session. It reports state changes and prints new activities as they occur. If no ID is provided, it defaults to the latest session. |
| `repl <sessionId>` | `sessionId` (optional) | An interactive shell that allows sending messages to a session while simultaneously tailing its activity log in the background. |

### Key Implementations

#### Activity Rendering
To make the output human-readable, the CLI uses:
- **Markdown Rendering**: `marked` and `marked-terminal` are used to render agent and user messages as styled terminal text.
- **Transparency**: Each activity displays its `type` and `originator` at the top for clarity.
- **Non-Exclusive Rendering**: Activities can display both rendered messages and structured data (e.g., progress updates, artifacts) simultaneously.
- **Specialized Renderers**:
    - **Plans**: Generated plans are displayed as a numbered list of steps with titles and descriptions.
    - **Session Status**: Clear visual markers for session completion or failure (including failure reasons).
    - **Artifacts**:
        - Git diffs (`unidiffPatch`) are extracted and printed as plain text.
        - Bash output is formatted as a terminal-like block showing the command, output, and exit code.
- **Originator Highlighting**: Activities are visually distinguished by their originator:
    - `AGENT`: Displayed in blue.
    - `USER`: Displayed in green.
- **Structured Formatting**: Timestamps, activity indices, and unique IDs are printed in a muted style to separate them from the core content.

#### Performance & Caching
To avoid slamming the API with redundant `GET` requests (especially during session restarts or frequent polling), the tool implements:
- **Persistent Cache**: `node-fetch-cache` with `FileSystemCache` stores responses in the `.jules-cache` directory.
- **Optimized Polling**: The `tail` and `repl` commands use a polling interval (3 seconds) to keep track of the session state and activity list without overloading the server.

## Technical Stack

- **Runtime**: Node.js (ES Modules)
- **API**: REST (`https://jules.googleapis.com/v1alpha`)
- **Dependencies**:
    - `marked`: Markdown parsing.
    - `marked-terminal`: Terminal-specific markdown rendering.
    - `highlight.js`: Syntax highlighting for terminal code blocks.
    - `node-fetch-cache`: HTTP caching layer.
    - `debug`: Internal API and activity logging.
    - `readline`: For the interactive REPL.

## Environment Variables

- `JULES_API_KEY`: Required for authentication with the Jules API.
- `JULES_DISABLE_CACHE`: When set to `true` or `1`, disables all API response caching.
