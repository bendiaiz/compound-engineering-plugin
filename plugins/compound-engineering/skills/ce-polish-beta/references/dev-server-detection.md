# Dev-server port detection cascade

This cascade runs **only when** `.claude/launch.json` is absent or has no `port` field for the resolved configuration. When `launch.json` specifies a port, use it verbatim and skip this cascade entirely.

Duplicated from `plugins/compound-engineering/skills/test-browser/SKILL.md` per the repo's "skill directories are self-contained" rule. Keep in sync manually if the test-browser cascade changes.

## Priority order

1. **Explicit argument** — if the user passed a `--port <n>` or `port:<n>` token, use it directly.
2. **Project instructions** — grep `AGENTS.md`, `CLAUDE.md`, or other instruction files for port references.
3. **`package.json`** — check `dev`/`start` scripts for `--port <n>` or `-p <n>` flags.
4. **Environment files** — check `.env`, `.env.local`, `.env.development` for `PORT=<n>`.
5. **Default** — fall back to `3000` (Rails, Next.js) or framework-specific default when known.

## Reference cascade

```bash
PORT="${EXPLICIT_PORT:-}"

if [ -z "$PORT" ]; then
  PORT=$(grep -Eio '(port\s*[:=]\s*|localhost:)([0-9]{4,5})' AGENTS.md 2>/dev/null | grep -Eo '[0-9]{4,5}' | head -1)
fi

if [ -z "$PORT" ]; then
  PORT=$(grep -Eio '(port\s*[:=]\s*|localhost:)([0-9]{4,5})' CLAUDE.md 2>/dev/null | grep -Eo '[0-9]{4,5}' | head -1)
fi

if [ -z "$PORT" ]; then
  PORT=$(grep -Eo '\-\-port[= ]+[0-9]{4,5}' package.json 2>/dev/null | grep -Eo '[0-9]{4,5}' | head -1)
fi

if [ -z "$PORT" ]; then
  PORT=$(grep -h '^PORT=' .env .env.local .env.development 2>/dev/null | tail -1 | cut -d= -f2)
fi

PORT="${PORT:-3000}"
```

## Pre-resolution guidance

This cascade is short, branching, and probes multiple files. It is a legitimate exception to the "no shell chaining in skill bodies" rule because it runs at pre-resolution time (before the agent sees the result) via `!`-backtick expansion. The error-suppressing `2>/dev/null` is part of graceful fallback, not concealed failure.

If a run produces an unexpected port, run the cascade commands individually to see which file contributed the value.

## Framework defaults

| Framework | Default port |
|-----------|--------------|
| Rails (`bin/dev`, `rails s`) | 3000 |
| Next.js | 3000 |
| Vite | 5173 |
| Procfile / Overmind (project-specific) | typically 3000, check `Procfile.dev` |
| Unknown | 3000 (prompt user to confirm) |
