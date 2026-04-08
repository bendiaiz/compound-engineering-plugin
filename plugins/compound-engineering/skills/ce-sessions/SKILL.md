---
name: ce:sessions
description: "Search and ask questions about your coding agent session history. Use when asking what you worked on, what was tried before, how a problem was investigated across sessions, what happened recently, or any question about past agent sessions. Also use when the user references prior sessions, previous attempts, or past investigations — even without saying 'sessions' explicitly."
---

# /ce:sessions

Search your session history.

## Usage

```
/ce:sessions [question or topic]
/ce:sessions
```

## Execution

If no argument is provided, ask what the user wants to know about their session history. Use the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). If no question tool is available, ask in plain text and wait for a reply.

Dispatch `compound-engineering:research:session-historian` with the user's question as the task prompt. Omit the `mode` parameter so the user's configured permission settings apply. In the dispatch prompt, include:

- The user's question
- The current working directory and git branch
- **Platform restriction:** "Search only [current platform] session history. Do not search other platforms unless the user explicitly asked for cross-platform results." — where [current platform] is Claude Code, Codex, or Cursor depending on which harness is running.

Return the agent's response directly.
