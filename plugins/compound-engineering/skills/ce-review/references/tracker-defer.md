# Tracker Detection and Defer Execution

This reference covers how Interactive mode's Defer actions file tickets in the project's tracker. It is loaded by `SKILL.md` when the routing question needs to decide whether to offer option C (File tickets), when the walk-through's Defer option executes, and when the bulk-preview of option C (File tickets per finding) is shown.

Interactive mode only. Autofix, Report-only, and Headless modes do not use this reference.

---

## Detection

The agent determines the project's tracker from whatever documentation is obvious. Primary sources: `CLAUDE.md` and `AGENTS.md` at the repo root and in relevant subdirectories. Supplementary signals (when primary documentation is ambiguous): `CONTRIBUTING.md`, `README.md`, PR templates under `.github/`, visible tracker URLs in the repo.

A tracker can be surfaced via MCP tool (e.g., a Linear MCP server), CLI (e.g., `gh`), or direct API. All are acceptable. The detection output is a tuple:

```
{ tracker_name, confidence, sink_available }
```

Where:
- `tracker_name` — human-readable name ("Linear", "GitHub Issues", "Jira"), or `null` when detection cannot identify a specific tracker
- `confidence` — `high` when the tracker is named explicitly in documentation (or via a linked URL to a specific project/workspace) and is unambiguously the project's canonical tracker; `low` when the signal is thin, conflicting, or implied only
- `sink_available` — `true` only when the agent can actually invoke the detected tracker (MCP tool is loaded, CLI is authenticated, or API credentials are in environment); `false` when the tracker is documented but no tool reaches it, or when no tracker is found at all

Detection is reasoning-based. Do not maintain an enumerated checklist of files to read. Read the obvious sources and form a confident conclusion; when the obvious sources don't resolve, the label falls back to generic wording and the agent confirms with the user before executing.

---

## Probe timing and caching

Availability probes run **at most once per session** and **only when the routing question is about to be asked**. Never speculatively at review start, never per-Defer, never per-walk-through-finding. The cached `{ tracker_name, confidence, sink_available }` tuple is reused for every Defer action in the same run.

Typical probe sequence (for the high-confidence named-tracker path):

1. Read `CLAUDE.md` / `AGENTS.md` for tracker references. If nothing found, set `tracker_name = null`, `confidence = low`.
2. If a named tracker is found, check its sink availability once — for GitHub Issues, run `gh auth status` and `gh repo view --json hasIssuesEnabled`. For Linear or other MCP-backed trackers, verify the relevant MCP tool is loaded and responsive. For API-backed trackers, verify credentials in environment.
3. Set `sink_available = true` only if the probe returns a working tool. If the probe fails or times out, set `sink_available = false` for this session and fall through to the next tier of the fallback chain below.

When the routing question is skipped entirely (R2 zero-findings case), no probes run. When option C is omitted because no sink is available (R20), the agent still needs to know *why* in order to explain — so the detection tuple is computed even when option C won't appear, but it reads from documentation only and skips availability probes that would spawn tool calls.

---

## Label logic

- When `confidence = high` AND `sink_available = true`: the routing question's option C and the walk-through's per-finding Defer option both include the tracker name verbatim. Example: `File a Linear ticket per finding`, `Defer — file a Linear ticket`.
- When `confidence = low` OR `sink_available = false` but a fallback sink exists: the labels read generically — `File an issue per finding`, `Defer — file a ticket`. Before executing the first Defer of the session, the agent confirms the tracker choice with the user using the platform's blocking question tool.
- When `sink_available = false` AND no fallback sink is available: option C is omitted from the routing question, option B (Defer) is omitted from the walk-through per-finding options, and the agent tells the user why in the routing question's stem.

---

## Fallback chain

When the named tracker is unavailable or no tracker is named, fall back in this order. Prefer durable external trackers over in-session-only primitives.

1. **Named tracker** (MCP tool, CLI, or API the agent can invoke directly)
2. **GitHub Issues via `gh`** — when `gh auth status` succeeds and the current repo has issues enabled (`gh repo view --json hasIssuesEnabled` returns `true`)
3. **Harness task-tracking primitive** — `TaskCreate` in Claude Code, `update_plan` in Codex, or the equivalent on other target platforms — used as a last resort and only after a once-per-session durability confirmation (below)

Never fall back to `.context/compound-engineering/todos/`. The internal-todos system is on a deprecation path (see plan scope boundaries) and must not be extended by this Defer path.

---

## Once-per-session harness-fallback confirmation

When the fallback to harness task-tracking primitive is in effect, and before the first Defer action of the session executes, the agent asks the user once using the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini):

> No documented tracker was found and `gh` is not available. Defer actions will create in-session tasks that do not survive past this session. Proceed for this and subsequent Defer actions?

Options:
- `Proceed with in-session tasks` — the agent continues with harness task creation for every Defer in this run
- `Cancel — leave findings as residual in the report` — the agent converts all pending Defers to Skip with a note, and surfaces the findings in the completion report's residual-work section

The confirmation is cached for the session. Subsequent Defer actions do not re-prompt.

When no blocking question tool is available, the agent presents numbered options and waits for the user's reply.

---

## Ticket composition

Every Defer action creates a ticket with the following content, adapted to the tracker's capabilities:

- **Title:** the merged finding's `title` (schema-capped at 10 words).
- **Body:**
  - Plain-English problem statement — reads the persona-produced `why_it_matters` from the contributing reviewer's artifact file at `.context/compound-engineering/ce-review/<run-id>/{reviewer}.json`, using the same `file + line_bucket(line, +/-3) + normalize(title)` matching headless mode uses (see SKILL.md Stage 6 detail enrichment). Falls back to the merged finding's title and first evidence item when no artifact match is available.
  - Suggested fix (when present in the finding's `suggested_fix`).
  - Evidence (direct quotes from the reviewer's artifact).
  - Metadata block: `Severity: <level>`, `Confidence: <score>`, `Reviewer(s): <list>`, `Finding ID: <fingerprint>`.
- **Labels** (when the tracker supports labels): severity tag (`P0`, `P1`, `P2`, `P3`) and, when the tracker convention supports it, a category label sourced from the reviewer name.
- **Length cap:** when the composed body would exceed a tracker's body length limit, truncate with `... (continued in ce-review run artifact: .context/compound-engineering/ce-review/<run-id>/)` and include the finding_id in both the truncated body and the metadata block so the artifact is discoverable.

The finding_id is a stable fingerprint composed as `normalize(file) + line_bucket(line, +/-3) + normalize(title)` — the same fingerprint used by the merge pipeline.

---

## Failure path

When ticket creation fails at execution (API error, auth expiry mid-session, rate limit, malformed body rejected, 4xx/5xx response), the agent surfaces the failure inline and asks the user using the platform's blocking question tool:

Stem:
> Defer failed: <tracker name> returned <error summary>. How should the agent handle this finding?

Options:
- `Retry on <tracker>` — re-attempt the same tracker once more (useful for transient errors)
- `Fall back to next sink` — move this finding's Defer to the next tier in the fallback chain (e.g., from Linear to GitHub Issues, or from GitHub Issues to harness task primitive)
- `Convert to Skip — record the failure` — abandon this Defer, note the failure in the completion report's failure section, and continue the walk-through or bulk flow

When a high-confidence named tracker fails at execution, the cached `sink_available` for that tracker is set to `false` for the rest of the session. Subsequent Defer actions that would target the same tracker fall straight through to the next tier without retrying a confirmed-broken sink.

When no blocking question tool is available, the agent presents numbered options and waits for the user's reply.

---

## Per-tracker behavior

Concrete behavior per tracker at execution time. The agent may invoke any of these through the appropriate interface (MCP, CLI, or API) — the choice depends on what is available in the current environment.

| Tracker | Interface | Invocation sketch | Body format | Labels |
|---------|-----------|-------------------|-------------|--------|
| Linear | MCP (preferred) or API | Create issue in the project/workspace identified by documentation; assign to the reporter if the MCP tool exposes user context | Markdown | Severity priority field if the MCP exposes it; otherwise include severity in body |
| GitHub Issues | `gh issue create` | Repo defaults to the current repo. Use `--label` for severity tag when labels exist; omit `--label` if the repo has no label fixture. Fall back to a label-less issue on first failure. | Markdown | `--label P0` / `--label P1` / etc. when labels exist |
| Jira | MCP or API | Create issue in the project identified by documentation; Jira's markdown dialect differs from GitHub's — use plain text in the body when MCP does not handle conversion | Plain text when MCP does not handle markdown | Severity priority field |
| Harness task primitive (last resort) | `TaskCreate` / `update_plan` / platform equivalent | Create one task per finding with subject = title and description = compact version of the body. No labels. Warn the user that tasks will not survive past the session (see once-per-session confirmation above). | Plain text, compact | None |
| No sink available | — | Defer option is omitted; findings remain in the report's residual-work section | — | — |

When uncertain, prefer "drop with explicit user-facing notice" over "pass through silently and hope." A Defer that produces no durable artifact and no user message is data loss.

---

## Cross-platform notes

The question-tool name varies by platform. Use the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). When no blocking tool is available, present numbered options and wait for the user's next reply before proceeding.

The fallback chain's final tier (harness task-tracking primitive) does not exist on every target platform. When converted for a platform that has no equivalent of `TaskCreate` / `update_plan`, the agent should treat that platform as "no harness sink" and move directly to the no-sink behavior (omit Defer from menus and tell the user why).
