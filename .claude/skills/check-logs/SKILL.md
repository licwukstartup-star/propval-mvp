---
name: check-logs
description: Read backend and frontend logs and summarise errors
tools: Read, Bash
---

Read the files `backend_log.txt` and `frontend_log.txt` from the project root
(`C:\Users\licww\Desktop\propval-mvp`).

For each log:
1. Show the last 30 lines
2. List any ERROR, WARNING, or exception lines with their line numbers
3. Flag anything that needs immediate attention

Present as two sections: **Backend** and **Frontend**. Be concise — only flag
real problems, not routine startup messages.
