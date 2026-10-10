# Incremental Patch Diff and Terminal Preview

## Overview
Currently, Jules CLI prints full cumulative unified diffs (`unidiffPatch`) whenever a `gitPatch` artifact is received. Large patches flood the terminal output and obscure activity updates.

Furthermore, each `gitPatch` artifact from the API represents a cumulative diff from the session base commit ($Base \rightarrow Current$). Users cannot easily see what changed in the current step versus previous steps.

## Findings & Solution

### 1. Cumulative Patch File Output
- Save/overwrite the latest cumulative patch file at `/tmp/jules-<sessionId>.patch`.
- Print the path and apply instructions in CLI output:
  ```text
  📄 Patch saved: /tmp/jules-<sessionId>.patch
  💡 Apply to repository: git apply /tmp/jules-<sessionId>.patch
  ```

### 2. Computing Incremental Diffs ($\Delta = P_2 - P_1$)
To compute what changed in the latest step without touching the user's working directory:
1. Initialize a dummy temporary git repository in `/tmp`.
2. Apply Patch 1 ($P_1$) and commit as `C1`.
3. Create a branch from root, apply Patch 2 ($P_2$), and commit as `C2`.
4. Run `git diff C1 C2` to obtain the exact incremental delta $\Delta$.
5. Automatically clean up the temporary directory.

### 3. N-Line Terminal Preview
- Display an N-line preview (e.g. first 10 lines) of the incremental delta $\Delta$.
- Truncate long diffs with a summary line showing insertions/deletions and the saved patch file path for full details.
