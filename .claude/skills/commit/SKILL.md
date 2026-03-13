---
name: commit
description: Stage changed files and commit with a conventional commit message
tools: Bash
---

Create a git commit for the current changes:

1. Run `git status` to see what's changed.
2. Run `git diff --stat` to understand the scope.
3. Stage only relevant source files (never `.env`, never binary blobs):
   - Use `git add <specific files>` — never `git add -A` blindly.
4. Draft a conventional commit message:
   - Format: `type(scope): short description`
   - Types: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`
   - Subject line 72 chars max. Add a body if the change needs explanation.
5. Commit using a HEREDOC to preserve formatting.
6. Run `git status` after to confirm success.

NEVER push — commit only. Show the commit hash when done.
