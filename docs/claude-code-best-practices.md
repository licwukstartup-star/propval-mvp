# Claude Code Best Practices — PropVal Reference

> Research compiled March 2026. Apply to all future Claude Code sessions on this project.

---

## 1. CLAUDE.md Rules

- **Hard limit: 200 lines.** Beyond that, Claude starts ignoring rules.
- Include only what Claude would get wrong without it — prune everything else.
- Use `@filename` imports for supplementary docs instead of pasting inline.
- Split into: project overview → stack → conventions → critical patterns → known issues.
- Checked into git — team-shared standards only. Personal preferences go in `~/.claude/CLAUDE.md`.

---

## 2. Memory Files

- `MEMORY.md` (first 200 lines loaded every session) — project discoveries, preferences, debug findings.
- Deeper topic files (`debugging.md`, `patterns.md`) loaded on demand — link from MEMORY.md.
- Use memory for **discoveries**. Use CLAUDE.md for **standards**.
- Tell Claude "remember this" to persist anything important across sessions.
- Review with `/memory`. Delete stale entries — wrong memory is worse than no memory.

---

## 3. Hooks (Deterministic Automation)

Unlike CLAUDE.md (advisory), hooks **guarantee** execution. They can block actions.

### Hook Events

| Event | Use Case |
|-------|----------|
| `PreToolUse` | Block dangerous operations (protect `.env`, block `rm -rf`) |
| `PostToolUse` | Auto-format after every file edit (prettier, black) |
| `Notification` | Desktop alert when Claude needs input |
| `SessionStart` | Set up environment, load PATH variables |
| `Stop` | Verify tasks are actually complete before stopping |

### Hook Scopes (cascade, don't replace)
1. `~/.claude/settings.json` — global, all projects
2. `.claude/settings.json` — project-wide, checked into git
3. `.claude/settings.local.json` — personal overrides, gitignored

### Exit Codes
- `0` = allow
- `2` = **block** the action
- Any other non-zero = warn but allow

### Key Hooks to Implement for PropVal

**Protect `.env` from edits:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/protect-env.sh"
          }
        ]
      }
    ]
  }
}
```

**Desktop notification when Claude is waiting:**
```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -Command \"[System.Windows.Forms.MessageBox]::Show('Claude needs your attention')\""
          }
        ]
      }
    ]
  }
}
```

---

## 4. Permissions (Reduce Approval Fatigue)

Pre-approve routine operations. Gate everything destructive.

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(npm test)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(py -3.11 *)",
      "Read(**)"
    ],
    "deny": [
      "Read(.env*)",
      "Bash(curl *)",
      "Bash(wget *)"
    ]
  }
}
```

Git push, file delete, DB changes — always ask.

---

## 5. MCP Servers (Top Picks for SaaS Dev)

| Server | Use Case |
|--------|----------|
| **GitHub** | Create issues, review PRs, fetch repo code |
| **PostgreSQL / Supabase** | Query DB directly without copy-pasting results |
| **Sentry** | Fetch error stack traces directly |
| **Slack** | Send deploy notifications, read channel context |

Add project-scoped servers to `.mcp.json` (checked into git).
Add personal tools to `~/.claude.json` with `--scope user`.

---

## 6. Skills (Reusable Slash Commands)

Store in `.claude/skills/<name>/SKILL.md`. Invoke with `/<name>`.

Useful PropVal skills to create:
- `/restart` — kill and restart both servers with log capture
- `/check-logs` — read backend_log.txt and frontend_log.txt, summarise errors
- `/commit` — stage, write conventional commit message, commit
- `/deploy-check` — run tests, check for secrets, confirm before push

```markdown
---
name: check-logs
description: Read backend and frontend logs and summarise any errors
tools: Read, Bash
---
Read backend_log.txt and frontend_log.txt. Summarise errors, warnings,
and the last 20 lines of each. Flag anything that needs fixing.
```

---

## 7. Plan Mode Workflow

**Use for:** multi-file changes, unfamiliar code, high-risk modifications.
**Skip for:** typo fixes, single-line changes, obvious renames.

```
1. Describe problem
2. Claude explores codebase (read-only)
3. Claude proposes plan
4. You approve (or edit)
5. Claude executes fully
6. Verify with logs/tests
```

**Current PropVal workflow** (agreed):
- You describe problem
- Claude gives plan
- You approve
- Claude executes until done, reads logs autonomously

---

## 8. Parallel Agents

Use subagents when:
- Task produces verbose output that would pollute main context
- Multiple independent investigations can run simultaneously
- You want a restricted tool set for a subtask

```
Agent types:
- Explore (fast, read-only) — codebase search and discovery
- Plan (architect) — design before coding
- general-purpose — complex multi-step execution
```

Spawn up to 3 in parallel per message for independent tasks.

---

## 9. Security

| Risk | Mitigation |
|------|-----------|
| Prompt injection via external data | Never pipe untrusted content directly to Claude |
| Accidental secret exposure | Hook to block `.env` reads/writes; deny `Read(.env*)` in permissions |
| Runaway API calls | Timeout middleware (60s hard cap per request) |
| Accidental force push | Never auto-approve `git push --force` |
| MCP server trust | Only use servers from trusted vendors; never put secrets in `.mcp.json` |

---

## 10. Context Window Management

| Command | What it does |
|---------|-------------|
| `/clear` | Fresh context — use between unrelated tasks |
| `/compact` | Summarise current context, keep working |
| `/rewind` | Undo last N actions |
| `--continue` | Resume last session |
| `--resume` | Pick from recent sessions |

**Rule of thumb:** If you've corrected the same mistake twice, `/clear` and restart with a better prompt. Don't fight a polluted context.

---

## 11. PropVal-Specific Action List

Priority order for setup improvements:

- [ ] Create `.claude/settings.json` with permission allowlist
- [ ] Create `.claude/hooks/protect-env.sh` to block `.env` edits
- [ ] Create `.claude/skills/check-logs/SKILL.md`
- [ ] Create `.claude/skills/restart/SKILL.md`
- [ ] Create `.claude/skills/commit/SKILL.md`
- [ ] Prune CLAUDE.md below 200 lines, move verbose sections to imported files
- [ ] Add Supabase MCP server for direct DB querying
- [ ] Add timeout middleware to backend (60s hard cap)

---

## 12. The Formula

1. **Focused CLAUDE.md** (<200 lines) — standards only
2. **Auto-memory** — let Claude take notes, review regularly
3. **3-5 hooks** — notification + file protection + auto-format
4. **Permission allowlist** — reduce approval fatigue for safe ops
5. **Plan → approve → execute** — for anything multi-file
6. **Subagents** — delegate verbose/parallel work
7. **`/clear` aggressively** — fresh context between unrelated tasks
8. **Skills** — encode repeatable workflows as slash commands

---

*Sources: Claude Code official docs — best-practices, hooks-guide, memory, mcp, settings, sub-agents, skills, security*
