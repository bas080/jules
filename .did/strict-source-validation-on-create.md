# Fix: Strict `--source` Resolution & Validation on Session Create

## Overview
Fix issue where running `jules repl --create --source <source>` failed to link the source to the created session, and enforce strict source validation so sessions are never created without a source if `--source` is specified.

## Implementation Details
1. Updated `createSession()` to validate `sourceId` and resolve short names (`owner/repo`) against `fetchSources()` prior to making the `POST /v1alpha/sessions` API call.
2. Abort with an error if source resolution fails or if `--source` is specified without a valid string, preventing unlinked session creation.
3. Pass `body.source = finalSourceId` in POST payload when source is provided.
