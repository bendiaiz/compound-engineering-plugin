# Checklist template

This is the scaffold for the user-facing `checklist.md` that polish writes into
the run-artifact directory (`.context/compound-engineering/ce-polish/<run-id>/checklist.md`).
The user edits this file directly — polish re-reads it on each `ready` ack.

## File shape

```markdown
# Polish checklist

Branch: <current_branch>
Base: <base_branch>
Review verdict: <Ready to merge | Ready with fixes>
Generated: <ISO 8601 UTC>

Edit each item's `action` to tell polish what to do when you reply `ready`.
Reply `done` to end polish. Reply `cancel` to stop without dispatch.

## Item 1 — <concise title derived from diff/PR body>
- action: <keep|skip|fix|note|stacked|replan>
- files: <comma-separated repo-relative paths>
- surface: <view|controller|model|api|asset|config|test|other>
- status: <manageable|oversized>
- notes: |
  <multi-line freeform notes from the user; the item's polish-relevant context>

## Item 2 — ...
```

## Field semantics

| Field | Generator fills | User edits |
|-------|----------------|------------|
| Header `## Item N — <title>` | Yes — N is 1-indexed, title is derived | Do not renumber; title may be rewritten for clarity |
| `action` | Defaults: `fix` for manageable feature-bearing items, `stacked` for oversized items (pinned), `keep` for tests/config/asset-only changes | User picks the final action per the allowed list |
| `files` | Comma-separated, derived from the diff grouping for this item | User may prune files that are not in scope |
| `surface` | One of the surface categories from `scripts/extract-surfaces.sh` (dominant surface of the item) | Read-only — polish re-derives if `files` changes |
| `status` | `manageable` or `oversized` from `scripts/classify-oversized.sh` | Read-only — the user's tool for "this is too big" is `action: replan` or `action: stacked`, not changing status |
| `notes` | Pre-filled with the relevant PR-body paragraph + test-scenario hints from the plan (when provided) | User rewrites freely — multi-line is encouraged via `notes: |` |

## Allowed actions

| Action | Meaning | Who sets it |
|--------|---------|-------------|
| `keep` | No polish fix needed; the item is fine as-is | User (or default for non-feature surfaces) |
| `skip` | Skip for this run; do not count as polished | User |
| `fix` | Dispatch a polish sub-agent per the dispatch matrix | User (default for manageable feature items) |
| `note` | Record user notes into the run artifact; do not dispatch a sub-agent | User |
| `stacked` | Write a stacked-PR seed file; do not attempt to polish in-place | Generator (pinned for oversized) |
| `replan` | User flagging that this item exceeds the one-focus-area contract even though `classify-oversized.sh` rated it manageable; route to replan-seed | User |

## Pinning rule

If `status: oversized`, the generator pins `action: stacked`. The parser rejects
any attempt to change an oversized item's action to anything other than
`stacked` — oversized items are routed to stacked-PR seeds, not fixed in-place.

To override "this is oversized" judgment, the user must edit a stacked-PR seed
file (or the plan) and re-run polish on a smaller slice; they cannot smuggle
oversized work through as `action: fix`.

## Multi-line notes

Use the YAML-style `notes: |` pipe to start a multi-line block. The parser
treats every line after `notes: |` as part of the notes until the next `## Item`
header or a new `- key:` field line. Blank lines are preserved.
