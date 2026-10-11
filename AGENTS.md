# AGENTS.md

## Project Documentation

Detailed information regarding Project Jules, its architecture, CLI usage, commands, and technical stack can be found in [`docs/project.md`](docs/project.md).

## Testing Guidelines

When developing or debugging tests, use `node --test --test-name-pattern="<pattern>"` (or `npm test -- --test-name-pattern="<pattern>"`) to run specific tests or sub-suites rather than running the entire test suite every time.

## Task and Issue Tracker (`did`)

This repository uses `did`, a file-system-native issue and dependency tracker stored in the `.did/` directory.

### Common `did` Commands

- `did status`: List actionables (leaf nodes with all sub-items done).
- `did search <query>`: Search task paths and task file contents.
- `did show <path>`: Print task contents at `<path>`.
- `did add <path>`: Create a task node or nested issue at `<path>`.
- `did done <path>`: Mark task at `<path>` as resolved.
