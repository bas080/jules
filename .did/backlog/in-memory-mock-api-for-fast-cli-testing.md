# Feature: Fast In-Memory Mock API for Testing Jules CLI

## Overview
Currently, `test/cli.test.js` spins up a local HTTP server on `127.0.0.1` and spawns a new Node.js child process for each CLI test case. To dramatically improve test execution speed and eliminate TCP socket / process startup overhead, allow `./jules` to use an in-memory API dispatcher or injected fetch mock during testing.

## Proposed Design
1. **Mock Fetch Injection**:
   Expose an environment variable (e.g. `JULES_IN_MEMORY_MOCK=1`) or module export that replaces `fetch` with an in-memory router function.
2. **Speed Benefits**:
   - Reduces test suite duration from ~25s down to <2s.
   - Eliminates port binding, TCP socket allocation, and process spawn latency.
   - Prevents potential environment rate-limiting or firewall inspection delays.
