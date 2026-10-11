# Feature: Migrate CLI Argument Parsing to Yargs

## Overview
Replace `commander` with `yargs` for parsing CLI subcommands, positionals, flags, and options in `./jules`.

## Implementation Details
1. Replaced `commander` dependency with `yargs` (`v18.2.0`).
2. Explicitly registered all subcommands (`sessions`, `sources`, `cleanup`, `create`, `tail`, `repl`, `approve`, `send`) with Yargs `.command()` builder functions.
3. Added global CLI options (`--api-key`, `--api-url`, `--disable-cache`, `--poll-interval`) to `yargs` so they show up on `jules --help`.
