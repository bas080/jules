# Feature: /unarchive REPL Command

## Overview
Add an `/unarchive` command to `jules repl` (and `jules unarchive` CLI subcommand) to restore an archived session via the Jules API.

## Requirements
- Call API endpoint `POST /v1alpha/sessions/{id}:unarchive`.
- Update session state and display confirmation message in REPL.
- Add `/unarchive` to REPL slash command `/help` documentation.
