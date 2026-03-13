---
name: restart
description: Kill and restart both backend and frontend servers with log capture
tools: Bash, Read
---

Restart both PropVal development servers:

1. Kill any existing processes on ports 8000 (backend) and 3000 (frontend):
   - Use `netstat -ano | grep ":8000\|:3000"` to find PIDs
   - Use `taskkill //F //PID <pid>` to kill them

2. Start backend in background with log capture:
   `cd /c/Users/licww/Desktop/propval-mvp/backend && py -3.11 -m uvicorn main:app --reload > ../backend_log.txt 2>&1`

3. Start frontend in background with log capture:
   `cd /c/Users/licww/Desktop/propval-mvp/frontend && npm run dev > ../frontend_log.txt 2>&1`

4. Wait 6 seconds, then verify both ports are listening with `netstat`.

5. Read the first 15 lines of `backend_log.txt` to confirm clean startup.

6. Report status and show clickable links:
   - Backend: http://localhost:8000
   - Frontend: http://localhost:3000
