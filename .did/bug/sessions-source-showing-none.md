# Bug: `jules sessions` displays `none` for session Source column

## Symptoms
Running `jules sessions` renders the session table showing `none` in the Source column even for sessions linked to a repository source.

## Root Cause
In `src/common.js`:
```javascript
const rawSource = s.sourceContext || s.source || s.sourceId
```
When `s.sourceContext` is an object (or structured field returned by the Jules API, e.g. `{ source: "sources/github/owner/repo" }` or `{ name: "sources/..." }`), `formatSourceDisplay(rawSource)` stringifies it or expects a string, resulting in `none` or improper formatting.

## Solution
Update `formatSourceDisplay(s)` in `src/common.js` to extract string fields if `s` is an object (e.g. `s.source || s.name || s`):
```javascript
export function formatSourceDisplay (s) {
  if (!s) return 'none'
  let display = typeof s === 'object' ? (s.source || s.name || String(s)) : String(s)
  if (display.startsWith('sources/github/')) {
    display = display.replace(/^sources\/github\//, '')
  } else if (display.startsWith('sources/')) {
    display = display.replace(/^sources\//, '')
  }
  return display
}
```
