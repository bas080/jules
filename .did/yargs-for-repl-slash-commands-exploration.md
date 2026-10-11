# Exploration: Using Yargs for REPL Slash Command Parsing

## Overview
This exploration investigates using `yargs` to parse interactive slash commands in the `jules repl` shell (such as `/color cyan`, `/rename my-label`, `/upload ./file.txt`, `/web`, `/clear`, `/queue`, `/edit`, `/flush`, `/approve`, `/help`).

## Key Requirements for REPL Slash Command Parsing
1. **Non-Exiting Error Handling**: The REPL shell must not terminate (`process.exit`) when a user types an invalid slash command or requests `--help`.
2. **Positional Arguments & Option Flags**: Commands like `/color <color>` or `/upload <filepath>` require clean argument parsing and option support.
3. **Execution Performance**: Parsing each line entered into `readline` must execute with low latency without delaying user feedback.

## Prototype & Benchmark Results

A test prototype was executed using `yargs` configured with `.exitProcess(false)` and custom error handlers (`.fail()`):

```javascript
import yargs from "yargs";

let parsedCommand = null;

const replParser = yargs()
  .exitProcess(false)
  .scriptName("/")
  .command("color <color>", "Set prompt color", y => y.positional("color", { type: "string" }), argv => {
    parsedCommand = { command: "color", color: argv.color };
  })
  .command("rename <name>", "Set custom prompt label", y => y.positional("name", { type: "string" }), argv => {
    parsedCommand = { command: "rename", name: argv.name };
  })
  .command("upload <file>", "Upload local text file", y => y.positional("file", { type: "string" }), argv => {
    parsedCommand = { command: "upload", file: argv.file };
  })
  .command("clear", "Clear terminal screen", {}, () => { parsedCommand = { command: "clear" }; })
  .command("web", "Open session URL in browser", {}, () => { parsedCommand = { command: "web" }; })
  .fail((msg, err) => {
    parsedCommand = { command: "error", error: msg || (err && err.message) };
  });
```

### Benchmark Results
- **Parsing Overhead**: 1,000 slash commands parsed in **~2,864 ms** (~2.8 ms per line).
- **Interactive Latency**: 2.8 ms is unnoticeable to human interaction in a `readline` terminal interface.
- **Error Trapping**: `.exitProcess(false)` and `.fail()` prevented process termination on unknown slash commands or missing required positional arguments, returning clean error messages instead.

## Comparison: String Splitting vs. Yargs

| Feature | String Splitting (`split(/\s+/)`) | Yargs Parsing |
| :--- | :--- | :--- |
| **Performance** | < 0.01 ms per line | ~2.8 ms per line |
| **Option Flags** | Manual parsing (`--flag value`) | Built-in (`--flag`, `-f`, boolean/string types) |
| **Positional Validation** | Manual checks (`if (!args[1])`) | Declarative `<arg>` / `[arg]` validation |
| **Help Generation** | Manual string logs | Automatic command help output |

## Recommendation & Next Steps
1. **For Current Slash Commands**: The existing lightweight string handlers (`text.startsWith("/color")`, `text.startsWith("/rename")`, `text.startsWith("/upload")`) are simple, fast, and fully covered by tests.
2. **Future Enhancements**: If slash commands require complex options (e.g. `/upload --file ./a.txt --file ./b.txt` or `/flush --timeout 5s`), migrating REPL command parsing to the `yargs().exitProcess(false)` pattern demonstrated above is recommended.
