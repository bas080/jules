# Reduce HTTP 429 Rate Limit Errors in REPL and Tail Polling

## Overview
Prevent HTTP 429 (`RESOURCE_EXHAUSTED` / Rate Limit Exceeded) errors from dumping large raw JSON blocks into the REPL and tail screens during background polling loops.

## Implementation Details
1. **Automatic Retries in `apiRequest`**:
   - `apiRequest()` retries up to 2 times with exponential backoff on HTTP 429 responses before throwing.
2. **Exponential Polling Backoff**:
   - `tail()`, `sendMessageAndTail()`, and `repl()` polling loops double the poll interval up to 30s when encountering 429 errors, resetting once requests succeed.
3. **Concise Warnings**:
   - Suppress multiline JSON error dumps during background polling loops, logging a single-line warning (`⚠️ Rate limit reached (HTTP 429). Retrying with backoff...`) unless `process.env.DEBUG` is enabled.
