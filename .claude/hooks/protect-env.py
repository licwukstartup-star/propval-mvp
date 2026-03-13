"""
PreToolUse hook: block any Edit/Write targeting .env files.
Exit 2 = block the action. Exit 0 = allow.
"""
import sys
import json

try:
    data = json.load(sys.stdin)
    file_path = data.get("tool_input", {}).get("file_path", "")
    filename = file_path.replace("\\", "/").split("/")[-1]

    if filename.startswith(".env"):
        print(
            f"BLOCKED: Editing '{filename}' is not permitted via Claude Code. "
            "Edit .env files manually to prevent accidental secret exposure.",
            file=sys.stderr,
        )
        sys.exit(2)
except Exception:
    pass  # Never block on hook error

sys.exit(0)
