# Fix this

Caused because the loop starts before the session is created.

```
❯❯ jules jules create "Fix the outdated docs. The source code is the source of truth. Read that first" --source bas080/jules
Creating session...
Source ID: sources/github/bas080/jules
Prompt: "Fix the outdated docs. The source code is the source of truth. Read that first"
Session created successfully! ID: sessions/14335900485077787419
Jules REPL started for session: sessions/14335900485077787419
Type your message and press Enter. Press Ctrl+C to exit.

jules > 
[7:53:48 AM] State: QUEUED
jules > Error in REPL background loop: API Error (404): {
  "error": {
    "code": 404,
    "message": "Requested entity was not found.",
    "status": "NOT_FOUND"
  }
}

jules > 
[7:53:54 AM] State: IN_PROGRESS
jules > 
```
