# Splitting Workflow

Decompose a feature branch into a chain of stacked PR layers using `gh stack`. This reference is loaded by `SKILL.md` when split-mode work has cleared the basic state gate and, for auto-invoked entries, the effectiveness gate.

Use the platform's blocking question tool whenever this workflow says "ask the user" (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). If none is available, present numbered options and wait for the user's reply before continuing.

When the workflow has multiple sequential steps, track them with the platform's task-tracking tool (`TaskCreate` / `TaskUpdate` / `TaskList` in Claude Code, `update_plan` in Codex). One task per phase is a reasonable default; add sub-tasks for the per-layer loop in Phase 3.

---

## CLI verification pattern (read first)

Before invoking any `gh stack <cmd>`, run `gh stack <cmd> --help` first to verify current flags and behavior. gh-stack is in GitHub's private preview; flags and output formats may evolve between versions.

This reference file invokes the following subcommands — verify each before first use in the session:

- `gh stack init` — create the first layer (or adopt the current branch as the first layer)
- `gh stack add` — add a branch on top of the current stack tip
- `gh stack push` — push all stack branches to the remote
- `gh stack submit` — create (or update) PRs for the stack on GitHub
- `gh stack rebase` — cascading rebase across the stack, for mid-construction layer adjustment
- `gh stack unstack` — teardown; used only in rollback

Treat any command-shape assumption in this file as a routing hint, not a contract. If `--help` output disagrees with the invocation below, follow the `--help` output.

---

## Phase 1 — Analyze

Goal: understand what changed on the branch well enough to propose a decomposition.

1. Run the detection script (relative to the skill directory):

   ```bash
   scripts/stack-detect <base-branch>
   ```

   Pass the repo's base branch (typically `main` or `master`). `<base-branch>` should not include the `origin/` prefix.

2. Read the `=== CHANGE_SUMMARY ===` and `=== COMMIT_LOG ===` sections from the script output. Those give net LOC, directory spread, per-file change stats, and the commit history ahead of base.

3. Read the full diff and commit log using git as needed — the agent should understand the substance, not just the shape:

   ```bash
   git log <base-branch>..HEAD --stat
   git diff <base-branch>...HEAD
   ```

   For large diffs, prefer reading per-commit (`git show <sha>`) or per-file (`git diff <base>...HEAD -- <path>`) rather than loading the entire diff into context at once.

### Grouping strategy

**V1 — commit-based grouping (preferred, use this today):** Propose layers based on existing commit boundaries. Walk the commit list from oldest to newest and group consecutive commits that address the same concern into a single layer. Commit-based grouping is deterministic (uses git-native cherry-pick ranges), preserves the developer's original intent, and avoids partial-file ambiguity.

Signals that consecutive commits belong in the same layer:

- They touch overlapping files or the same subsystem.
- Their messages describe one thread of work (e.g., three commits that iterate on the same schema).
- Later commits in the group would not compile or pass tests without earlier ones.

Signals that a commit starts a new layer:

- The subsystem or directory prefix shifts substantially.
- The commit message changes register (e.g., from "wire up API" to "polish UI").
- The commit is a standalone refactor or rename that makes sense to ship on its own.

**V2 — semantic diff analysis (deferred, future work):** Instead of respecting commit boundaries, the model would group hunks by concern (data model, API, UI, infrastructure) regardless of which commit introduced them. This enables cleaner layers when the developer's commit history is noisy, but requires partial-file decomposition (hunk staging) which V1 does not do. Do not attempt V2 in this version.

### Early exit — single concern

If Phase 1 concludes that all commits address one tightly-coupled concern and cannot be meaningfully separated, do not force a stack. Tell the user plainly, for example:

> These changes read as a single logical unit. Splitting would be ceremony — a single PR will review fine. Shall I hand off to `git-commit-push-pr` to ship as one PR?

If the user agrees, stop this workflow and defer to `git-commit-push-pr`. Do not fabricate layer boundaries to justify a stack.

---

## Phase 2 — Propose layers (mandatory approval gate)

Present the split plan to the user. This is a **mandatory gate for all invocation modes** — manual, delegated, and auto-invoked. The effectiveness gate in `SKILL.md` Step 5 only runs for auto-invoked entries, but the layer-proposal gate here always runs because the agent's proposed split is a guess until the user confirms.

For each proposed layer, include:

- **Layer name and branch name** (e.g., `feat/billing-data-model`, `feat/billing-api`, `feat/billing-ui`). Follow the repo's branching conventions when they are discernible from existing branches.
- **Files in this layer** — full paths, grouped if helpful.
- **Estimated line count** — net LOC that will land in this layer (additions + deletions as reported in stats).
- **One-sentence summary** of what this layer accomplishes.
- **Dependencies on prior layers** — which earlier layers in the stack this layer assumes (typically "layer N-1" but be explicit when a layer depends on something further down).

Then ask the user to approve, adjust, or reject.

Use the platform's blocking question tool with three options:

1. **Approve** — proceed to Phase 3 as proposed.
2. **Adjust** — the user describes the adjustment (combine layers, split further, move files between layers, rename a branch, change ordering). Apply the adjustment and re-present the revised proposal for approval. Loop until approved or rejected.
3. **Reject** — stop the workflow, defer to `git-commit-push-pr` to ship as a single PR.

Common adjustments to expect:

- "Combine layers 1 and 2" — merge their file sets and commit messages.
- "Split the UI layer into form + list" — the user sees a finer boundary the agent missed.
- "Move `lib/billing/validation.ts` to layer 2" — the user has context on where a cross-cutting file primarily belongs.

### V1 constraint: one file per layer

Each file belongs to exactly one layer. When a file's changes span concerns:

1. Assign the file to the layer where its **primary** changes belong (the concern that accounts for most of the edits, or the concern that cannot be delivered without this file).
2. Note the cross-cutting nature in that layer's PR description (Phase 4), so reviewers know to expect tangential hunks.

Per-hunk staging (splitting a single file across multiple layers) is deferred to V2. If a file genuinely cannot be assigned to a single layer without producing broken intermediate states, surface that to the user and ask whether to combine the affected layers or accept the cross-cutting note.

---

## Phase 3 — Create the stack (local only; do NOT push yet)

**Rollback protocol — record state before any mutation.** Before creating any branches, capture the original branch name and HEAD SHA:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

Persist these values for the duration of the workflow. If anything fails before Phase 4, these anchor the rollback.

**Guiding principle:** complete ALL local branch construction AND verify each layer's basic checks BEFORE running any `gh stack push` / `gh stack submit`. Separating local construction from remote submission bounds the blast radius of a failure to local state — nothing reaches GitHub until the full stack has been validated locally.

### Per-layer loop

For each approved layer, from bottom (closest to the base branch) to top:

1. **Create the branch on the stack.**

   - **Layer 1 (first layer):** run `gh stack init`. Run `gh stack init --help` to confirm flag shape. The installed extension supports:
     - `gh stack init [branches...]` — initialize with explicit branch names (prompts if omitted).
     - `--adopt` / `-a` — track existing branches as part of a stack. Use this if adopting the current branch as the first layer rather than creating a fresh branch.
     - `--base <branch>` / `-b` — trunk branch for the stack (defaults to the repo default branch).
     - `--prefix <string>` / `-p` and `--numbered` / `-n` — auto-generated numbered branch names from a prefix.

     The typical V1 invocation is `gh stack init <layer-1-branch-name> --base <base-branch>` to create a fresh layer-1 branch off the base. Use `--adopt` only when the plan calls for reusing the current branch as layer 1.
   - **Layer 2 and above:** run `gh stack add <branch-name>`. `gh stack add` creates the new branch on top of the current stack tip. Verify with `gh stack add --help` — the installed extension supports `-A` / `--all`, `-u` / `--update`, and `-m <message>` for combined stage+commit flows, but this workflow handles staging and committing explicitly (see steps 2 and 3), so those flags are generally not needed.

2. **Bring this layer's files into the working tree.**

   Because the new branch already inherits every commit from the previous layer, only files that are **new to this layer** need to be checked out from the original feature branch:

   ```bash
   git checkout <original-branch> -- <file1> <file2> ...
   ```

   Do not check out files that belong to earlier layers — those changes are already in the branch through inheritance. Checking them out again would duplicate content and likely break the diff.

   If a `git checkout` surfaces a merge conflict (rare at this stage, but possible when the original branch contains a merge commit), stop the loop, report the conflict to the user, and offer to resolve manually or revisit layer boundaries.

3. **Commit the layer.**

   Stage the checked-out files and commit with a conventional message scoped to this layer's concern:

   ```bash
   git add <file1> <file2> ...
   git commit -m "<type>(<scope>): <summary of what this layer accomplishes>"
   ```

   Use the repo's commit conventions (the root `AGENTS.md` / `CLAUDE.md` plus recent `git log` will indicate the preferred form). The commit body can elaborate if the single-line summary would obscure intent.

4. **Simplify and refactor within this layer's scope.**

   While constructing the layer, clean up code within the layer's scope — remove dead imports introduced by the original commits, tighten interfaces now that the layer's concern is isolated, improve naming that the layer makes newly coherent. This is a core value of stacked review: each layer is a natural opportunity for small quality improvements that would have been noise in the original monolithic branch. Keep refactors scoped to files already in this layer; a refactor that pulls in new files belongs in its own layer (or was mis-scoped in Phase 2 — surface that to the user).

   Amend or follow-up-commit the refactor onto the layer. Do not let refactor work leak across layer boundaries.

5. **Verify the layer builds and basic checks pass.**

   Run the project's test or build command if feasible (typical commands: `bun test`, `pnpm test`, `npm test`, `cargo test`, `go test ./...`, `bundle exec rspec`; infer from the repo). At minimum, verify the layer does not introduce obvious breakage before moving to the next layer. If the repo has a cheap syntax-check or type-check step, prefer it over a full test run for the intermediate layers.

   **If verification fails:** stop the loop. Report which layer failed and what the failure was. Offer the user two paths:

   - **Adjust layer boundaries.** A failing intermediate layer usually means the boundary is wrong — a file or change belonging to an earlier layer ended up in a later one (or vice versa). Return to Phase 2 with the failure context and revise the proposal.
   - **Roll back.** Execute the rollback protocol (see below) and stop.

   Do not push a broken layer.

6. **Repeat for the next layer** until the full stack is built locally.

Once the loop completes and every layer has passed its checks, proceed to Phase 4.

### Rollback protocol (invoke on any Phase 3 failure)

When Phase 3 fails partway through, restore the user to their pre-workflow state:

1. **Report clearly** which branches were created and what the failing condition was. The user needs to see the scope of what happened before deciding how to recover.
2. **Provide exact cleanup commands.** Typical recovery:

   ```bash
   # Return to the original branch
   git checkout <original-branch>

   # Delete the layer branches that were created (repeat per layer)
   git branch -D <layer-1-branch> <layer-2-branch> ...

   # If `gh stack init` ran, tear down the local stack tracking
   gh stack unstack --local
   ```

   Include `--local` on `gh stack unstack` so nothing reaches GitHub. Run `gh stack unstack --help` first to confirm the flag.

3. **Offer choices:**
   - **Abort** — run the cleanup commands above, restore the original branch at the original HEAD SHA, and stop the workflow.
   - **Adjust and retry** — return to Phase 2 with the failure context so the user can revise layer boundaries, then re-enter Phase 3.

Because Phase 3 is entirely local, rollback never has to touch GitHub. That is the whole point of separating local construction from remote submission.

---

## Phase 4 — Submit

Once every layer in Phase 3 passed its checks locally:

1. **Push the stack to the remote.**

   ```bash
   gh stack push
   ```

   Run `gh stack push --help` first to confirm flag shape. The installed extension supports `--remote <name>` when the auto-detected remote is wrong (e.g., fork-based workflows). `gh stack push` pushes every branch in the stack.

2. **Create the PRs.**

   ```bash
   gh stack submit
   ```

   Run `gh stack submit --help` first. Useful flags on the installed extension:

   - `--draft` — create PRs as drafts. Offer this to the user if the work is not ready for review.
   - `--auto` — use auto-generated titles without prompting. Do **not** use `--auto` in this workflow — the per-PR descriptions below are written by the agent, not auto-generated.
   - `--remote <name>` — mirror the remote used for `push`.

   `gh stack submit` opens (or updates) one PR per layer.

### Per-PR descriptions

Write one description per layer, following the writing principles from the `git-commit-push-pr` skill's Step 6 (describe the PR's net result, not a changelog; evidence when observable behavior applies; avoid cookie-cutter templates). Each layer's description is scoped to that layer's changes only — not the whole stack's ambition.

Minimum elements per layer description:

- **What this layer delivers** — one or two sentences describing the net result of this layer alone.
- **Why this layer is separable** — a short note on why it makes sense as an independent reviewable unit (independence, sequencing, reviewer divergence, mechanical vs. semantic split).
- **Dependencies** — which earlier layers in the stack this PR stacks on top of (gh stack submit will typically link these automatically, but restating them in the description helps reviewers).
- **Cross-cutting notes** — for any file assigned primarily to this layer but with tangential changes (per the V1 constraint in Phase 2), briefly note what else is touched so reviewers are not surprised.

### Top-of-stack PR — include a stack map

On the top-of-stack PR (the last layer), add a short section that lists the full chain so a reviewer landing on any PR in the stack can see the shape of the whole change. Example:

```
## Stack

1. feat/billing-data-model — schema + migrations
2. feat/billing-api — service + endpoints (stacks on #1)
3. feat/billing-ui — customer-facing form and list (stacks on #2) <- this PR
```

Use `gh stack view` to confirm the branch order before writing the stack map.

### Evidence

If any layer changes observable behavior (UI, CLI output, API behavior), capture evidence for that layer's PR following the same approach `git-commit-push-pr` uses — typically via the `ce-demo-reel` skill, scoped to the layer's changes. Do not lump evidence for the whole stack into the top PR; attach each artifact to the layer that demonstrates it.

---

## Scenarios and expected behavior

These scenarios shape how the workflow should respond in practice. Use them as a mental checklist when the workflow is in an unusual state.

- **Branch with ~30 files across 3 concerns** — Phase 1 groups commits into three layers. Phase 2 proposes them with branch names, file lists, and line counts. The user approves. Phase 3 builds the three branches locally and verifies each. Phase 4 pushes and submits.
- **User adjusts the proposal ("combine layers 1 and 2")** — merge the two layers' file sets and commit scope. Re-present the revised two-layer proposal. Proceed once the user approves.
- **All changes belong to one concern** — exit early in Phase 1. Tell the user a stack would be ceremony; offer to ship as a single PR via `git-commit-push-pr`. Do not force three layers out of one concern.
- **File appears in multiple proposed layers (partial changes span concerns)** — V1 behavior: assign the file to the layer where its primary changes belong and note the cross-cutting nature in that layer's PR description. If the file genuinely cannot be placed without breaking an intermediate layer, ask the user whether to combine the affected layers or accept the cross-cutting note. (V2 / hunk staging is deferred.)
- **Test failure on intermediate layer** — stop the Phase 3 loop, report the failing layer and the failure output, offer the user "adjust layer boundaries" or "roll back". Do not push a broken layer.
- **Merge conflict during `git checkout <original-branch> -- <files>`** — stop, report the conflict, offer manual resolution or revisiting the layer boundary that caused it. Do not attempt silent automated resolution.

---

## Summary of invariants

- The layer-proposal gate in Phase 2 is **mandatory for all invocation modes** (manual, delegated, auto-invoked).
- Record the original branch name and HEAD SHA before any mutation in Phase 3.
- Complete and verify **all** local branches before running any `gh stack push` / `gh stack submit`.
- One file per layer in V1. Cross-cutting files go to their primary layer with a note.
- Run `gh stack <cmd> --help` before first use of each subcommand in the session.
- On any Phase 3 failure, rollback touches only local state — nothing has reached GitHub yet.
