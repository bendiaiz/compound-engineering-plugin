---
name: ce:sessions
description: "Ask questions about your coding agent session history across Claude Code, Codex, and Cursor. Use to find what you worked on, what was tried before, how a problem was investigated, or any insight from past sessions."
---

# /ce:sessions

Ask questions about your session history.

## Usage

```
/ce:sessions [question]
/ce:sessions                  # prompts for a question
```

## Execution

If no argument is provided, ask the user what they want to know about their session history. Use the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). If no question tool is available, ask in plain text and wait for a reply.

Dispatch `compound-engineering:research:session-historian` with the user's question as the task prompt. Include the current working directory and git branch so the agent can scope its search.

Return the agent's response directly.
