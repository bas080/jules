# Feature: /unpause REPL Command

## Overview
Add an `/unpause` (or `/resume`) command to `jules repl` (and `jules unpause` CLI subcommand) to resume paused session execution via the Jules API.

## Requirements
- Call API endpoint `POST /v1alpha/sessions/{id}:resume` (or equivalent session resume method).
- Update session state and display confirmation message in REPL.
- Add `/unpause` to REPL slash command `/help` documentation.
