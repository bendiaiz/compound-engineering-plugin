# Replan seed template

When the per-batch preemptive check fires (majority-oversized, 3+ `replan`
actions, or total diff exceeds the batch thresholds), polish writes a
replan-seed file at:

```
.context/compound-engineering/ce-polish/<run-id>/replan-seed.md
```

The replan seed is polish's way of saying "the whole branch is too big — do
not polish in-place, re-plan it." The difference from a stacked-PR seed:

| Stacked-PR seed | Replan seed |
|-----------------|-------------|
| One item is too big | The whole batch is too big |
| Split out one slice, leave the rest | Re-plan the entire branch |
| `.context/.../stacked-pr-<n>.md` | `.context/.../replan-seed.md` |
| Zero-to-many per run | At most one per run |

## Seed file shape

```markdown
---
source_run: <run-id>
source_branch: <current_branch>
source_base: <base_branch>
source_head_sha: <HEAD SHA when polish fired the escalation>
source_plan: <plan path if the skill was invoked with plan:<path>, else null>
trigger: <majority_oversized|replan_actions|batch_diff_preemptive>
---

# Replan seed: <current_branch>

## Why polish is stopping

Polish refuses to continue because the batch as a whole exceeds the
one-focus-area contract:

- total_file_count: <N>
- total_diff_lines: <N>
- oversized_items: <count> of <total>
- manageable_items: <count>
- replan_actions: <count>

Trigger: **<trigger>** — <one-line explanation of which threshold fired>

Running polish across this batch would mix multiple concerns into a single
merge. The developer would lose the ability to test the result as a single
unit, which is the exact failure mode polish exists to prevent.

## What to do next

1. Revisit the plan at `<source_plan>` (if provided) and split it into smaller
   scopes — usually 2-4 stacked branches, each one focus area.
2. If no plan exists, run `/ce:brainstorm` with this seed as input to frame
   the re-plan.
3. Land the smaller stacked branches one at a time. Polish each on merge.

## Checklist snapshot

<render the full parsed checklist inline so the developer sees what polish saw>

## Stacked-PR seeds already emitted this run

<bulleted list of `stacked-pr-<n>.md` files polish wrote for individual oversized items,
or "none" if the trigger fired before any per-item seeds>

## What polish did not do

Polish **did not** dispatch sub-agents. No files were modified. No commits
were made. The dev server was started (for the entry gate and initial
checklist render) and may still be running — polish reports the PID so the
developer can decide to keep or kill it.
```

## How polish fills the template

- **Frontmatter** — from run state
- **Trigger** — exactly one of the three batch-preemptive conditions:
  - `majority_oversized` — more than half the items are `status: oversized`
  - `replan_actions` — 3 or more items have `action: replan`
  - `batch_diff_preemptive` — total diff exceeds 30 files or 1000 lines
    before any item thresholds fire
- **Checklist snapshot** — inline dump of the parsed checklist JSON rendered
  back to markdown, for context
- **Stacked seeds list** — only populated when some per-item seeds were
  written before the batch check fired

## Difference from stacked-pr seeds

Polish can emit both in the same run. If three items were oversized (three
stacked-pr seeds) and then majority-oversized also fires, polish writes one
additional replan-seed that supersedes the per-item seeds — the developer
should start with the replan seed, not the individual stacked seeds, when
the whole batch is suspect.

## What the developer does with this

Feed the replan seed into `/ce:plan` (or `/ce:brainstorm` if scope framing
is still fuzzy). The seed is literally the hand-off context — it includes
everything polish saw so the next workflow does not re-discover the batch.
