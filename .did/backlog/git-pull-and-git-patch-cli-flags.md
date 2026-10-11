# Feature: --git-pull and --git-patch CLI Flags

## Overview
Add top-level CLI flags to `jules` subcommands for git operations:
1. `--git-pull`: Automatically execute `git pull` before launching or interacting with a session (supported in `repl` and other relevant commands).
2. `--git-patch`: Automatically apply the latest git patch artifact received from Jules directly to the local repository using `git apply`.

## Proposed Design
- `--git-pull`: Ensure working branch is up to date before session interaction.
- `--git-patch`: When Jules produces a `changeSet.gitPatch`, automatically stage or apply the patch using `git apply <patchFile>` instead of requiring manual execution.
