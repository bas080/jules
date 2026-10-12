# Feature: /archive REPL Command

## Overview
Add an `/archive` command to `jules repl` (and `jules archive` CLI subcommand) to archive a session via the Jules API.

## Requirements
- Call API endpoint `POST /v1alpha/sessions/{id}:archive`.
- Update session state and display confirmation message in REPL.
- Add `/archive` to REPL slash command `/help` documentation.
