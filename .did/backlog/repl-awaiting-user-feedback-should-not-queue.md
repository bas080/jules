# REPL: `AWAITING_USER_FEEDBACK` State Should Not Queue Messages

## Overview
When a session enters the `AWAITING_USER_FEEDBACK` state, the agent is waiting for user response. Submitting a message in the REPL during this state should send the message immediately rather than queueing it.

## Details
- Update `isBusy` logic in REPL loop so that `AWAITING_USER_FEEDBACK` and `AWAITING_USER_INPUT` are treated as ready (non-busy) states.
- Messages entered when the session is `AWAITING_USER_FEEDBACK` should immediately trigger `sendMessage` to the Jules API.
