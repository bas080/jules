# Incremental Patch Diff and Terminal Preview

## Overview
Currently, Jules CLI saves full cumulative unified diffs (`unidiffPatch`) whenever a `gitPatch` artifact is received to `/tmp/jules-<sessionId>.patch` and suppresses printing full raw diff dumps to terminal output.

Furthermore, each `gitPatch` artifact from the API represents a cumulative diff from the session base commit ($Base \rightarrow Current$). Users need an interdiff ($\Delta = P_2 - P_1$) to see what changed in the current step versus previous steps.

## Findings & Solution

### 1. Cumulative Patch File Output
- Save/overwrite the latest cumulative patch file at `/tmp/jules-<sessionId>.patch`.
- Print the path and apply instructions in CLI output:
  ```text
  📄 Patch saved: /tmp/jules-<sessionId>.patch
  💡 Apply to repository: git apply /tmp/jules-<sessionId>.patch
  ```

### 2. Computing Interdiffs using `npm:diff` ($\Delta = P_2 - P_1$)
The `diff` package on npm (35M+ weekly downloads) can compute exact multi-file interdiffs in pure JavaScript without disk I/O or shell dependencies:
1. Parse Patch 1 ($P_1$) and Patch 2 ($P_2$) into file patch objects using `parsePatch()`.
2. Map file patches by filename across both patches.
3. Apply each single-file patch in memory using `applyPatch('', filePatch)` to obtain file contents $S_1$ and $S_2$.
4. Generate the interdiff for each modified file using `createTwoFilesPatch('a/file', 'b/file', S_1, S_2)`.

### 3. Alternative Computation via Native Git
Alternatively, if `git` is available:
1. Initialize a temporary git repository in `/tmp`.
2. Apply Patch 1 ($P_1$) and commit as `C1`.
3. Create a branch from root, apply Patch 2 ($P_2$), and commit as `C2`.
4. Run `git diff C1 C2` to obtain the exact interdiff $\Delta$.

### 4. N-Line Terminal Preview
- Display an N-line preview (e.g. first 10 lines) of the computed interdiff $\Delta$.
- Truncate long diffs with a summary line showing insertions/deletions and the saved patch file path for full details.
