# Stacked-PR seed template

When polish flags an item as `oversized` (pinned `action: stacked`), it writes
a stacked-PR seed file at:

```
.context/compound-engineering/ce-polish/<run-id>/stacked-pr-<n>.md
```

The seed file is a handoff document for the next loop of
brainstorm → plan → work that will deliver the too-big slice on its own
branch + PR. Polish does not attempt the work — it hands off.

## Seed file shape

```markdown
---
source_run: <run-id>
source_branch: <current_branch>
source_head_sha: <HEAD SHA when polish flagged this>
item_id: <N from checklist>
item_title: <title>
---

# Stacked PR seed: <item title>

## Why this is stacked

This item exceeded the single-PR polish threshold:
- file_count: <N> (>5 trips oversized)
- surface_count: <N> (>2 trips oversized)
- diff_lines: <N> (>300 trips oversized)
- user_judgment: <yes|no>  <!-- yes when user picked action: replan -->

Polish refuses to batch oversized work because the developer loses the ability
to test the resulting merge as a single unit. Ship this slice on its own
branch + PR, then re-run polish on the trimmed remaining work.

## What to do next

1. `git checkout <current_branch>`
2. Create a new branch for the stacked slice: `git checkout -b <current_branch>-<slug>`
3. Run `/ce:brainstorm` with the seed content below as the starting prompt
4. After the stacked PR merges, rebase the original branch on top and re-run polish

## Files in this slice

<bulleted file list — repo-relative paths>

## Dominant surface

<surface category from extract-surfaces.sh>

## User notes

<notes from the checklist item, verbatim>

## Source checklist item

```yaml
item_id: <N>
title: <title>
action: stacked
files: <comma-separated>
surface: <surface>
status: oversized
```
```

## How polish fills the template

- **Frontmatter** — sourced from run state (run_id, current_branch, HEAD sha, item id/title at write time)
- **Oversized reasons** — from `classify-oversized.sh` output for this item
- **Files / surface / notes** — from the parsed checklist item
- **User judgment flag** — set to `yes` when the item's action was `replan` at
  the time polish wrote the seed, `no` when the item was classified
  `oversized` from the start

## Why stacked seeds, not PRs

Polish cannot create the stacked PR itself — it does not know the right
problem framing, scope boundary, or test coverage for the sliced work. Those
are `ce:brainstorm` + `ce:plan` decisions. The seed captures the polish-time
context so the next run does not have to re-discover it.

## Multiple seeds per run

If a single run emits 3 or more stacked-PR seeds, the batch-preemptive check
also fires (see Phase 4's "Escalation" section) and polish offers a replan
of the entire branch before continuing. Seeds are numbered `stacked-pr-1.md`,
`stacked-pr-2.md`, etc., in the order they were flagged.
