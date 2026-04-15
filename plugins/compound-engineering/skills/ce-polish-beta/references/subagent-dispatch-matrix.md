# Sub-agent dispatch matrix

Polish dispatches fix sub-agents for each checklist item whose final action is
`fix`. The matrix below maps the item's `surface` (from
`scripts/extract-surfaces.sh`) to the sub-agent(s) that should handle it.

Agent names must be fully qualified: `compound-engineering:<category>:<name>`.

## Primary dispatch (by surface)

| Surface | Agent | Why |
|---------|-------|-----|
| `view` | `compound-engineering:design:design-iterator` | View files are UI-facing — iterate on layout/spacing/affordance with screenshot feedback |
| `view` (async-heavy) | `compound-engineering:review:julik-frontend-races-reviewer` | When notes mention flicker, double-submits, or lifecycle races |
| `asset` | `compound-engineering:design:design-iterator` | CSS/SCSS/image adjustments follow the same screenshot-diff loop |
| `controller` | `compound-engineering:review:maintainability-reviewer` | Polish on controllers is usually naming, action ordering, or extracting a helper |
| `model` | `compound-engineering:review:code-simplicity-reviewer` | Polish on models is almost always simplification — trimming dead code, consolidating callbacks |
| `api` | `compound-engineering:review:api-contract-reviewer` | Polish at the API boundary must not break contracts silently |
| `config`, `test`, `other` | — | Non-dispatchable by default — generator sets `action: keep` unless user overrides |

## Override triggers

The primary-surface agent is the default, but the item's `notes` may contain
keywords that swap or add agents:

| Keywords in notes | Additional agent |
|-------------------|------------------|
| "race", "flicker", "double-submit", "loading state" | `compound-engineering:review:julik-frontend-races-reviewer` |
| "simplify", "dry", "duplicate", "extract" | `compound-engineering:review:code-simplicity-reviewer` |
| "naming", "rename", "clarity" | `compound-engineering:review:maintainability-reviewer` |
| "figma", "design spec", "match design" | `compound-engineering:design:design-implementation-reviewer` |

When multiple triggers fire, dispatch them in parallel with the primary agent
unless the file groups overlap (see Grouping below).

## Grouping rule (file-collision safety)

Multiple items may share files (e.g., two polish notes on the same view). To
keep parallel dispatches from stepping on each other, build groups before
dispatching:

1. For each `fix` item, collect its file set.
2. Union any two items whose file sets intersect.
3. Each resulting disjoint group dispatches sequentially; independent groups
   dispatch in parallel.

Minimum parallelism threshold: **5 disjoint groups** before fanning out in
parallel. Below that, sequential dispatch keeps output legible and avoids the
overhead of coordinating fewer than 5 agents. This is the crossover heuristic
from `docs/solutions/workflow/codex-delegation-best-practices.md`.

## Sub-agent prompt shape

Each sub-agent gets:
- The item's title
- The item's files (full paths)
- The item's notes (user's polish directive)
- The dev server URL (e.g., `http://localhost:3000`) so design agents can
  screenshot-verify
- Plan path when provided via `plan:<path>` — sub-agents may consult it for
  test scenarios or goal framing, but must not widen scope beyond the item

Do **not** pass the full checklist to individual sub-agents — each agent sees
only its own item. Cross-item coordination stays in the parent skill.

## What sub-agents never do

- Do not bump plugin versions or modify `.claude-plugin/plugin.json`
- Do not author new test files for polish unless the user's notes specifically
  asked for it — polish is post-review refinement, not a second test-writing
  phase
- Do not reassign an item's action — if an agent discovers the item is truly
  oversized, it returns that judgment to the parent which re-routes through
  replan
- Do not commit or push — polish batches commits at Phase 5's conclusion
