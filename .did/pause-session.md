# Feature: /pause REPL Command

## Overview
Add a `/pause` command to `jules repl` (and `jules pause` CLI subcommand) to pause active session execution via the Jules API.

## Requirements
- Call API endpoint `POST /v1alpha/sessions/{id}:pause` (or equivalent session pause method).
- Update session state and display confirmation message in REPL.
- Add `/pause` to REPL slash command `/help` documentation.
