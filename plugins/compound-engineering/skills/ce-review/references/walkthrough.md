# Per-finding Walk-through

This reference defines Interactive mode's per-finding walk-through — the path the user enters by picking option A (`Review each finding one by one — accept the recommendation or choose another action`) from the routing question. It also covers the unified completion report that every terminal path (walk-through, LFG, File tickets, zero findings) emits.

Interactive mode only.

---

## Entry

The walk-through receives, from the orchestrator:

- The merged findings list in severity order (P0 → P1 → P2 → P3), filtered to `gated_auto` and `manual` findings that survived the Stage 5 confidence gate. Advisory findings are included when they were surfaced to this phase (advisory findings normally live in the report-only queue, but when the review flow routes them here for acknowledgment they take the advisory variant below).
- The cached tracker-detection tuple from `tracker-defer.md` (`{ tracker_name, confidence, named_sink_available, any_sink_available }`). `any_sink_available` determines whether the Defer option is offered; `named_sink_available` + `confidence` determine whether the label names the tracker inline.
- The run id for artifact lookups.

Each finding's recommended action has already been normalized by Stage 5 (step 7b — tie-break on action). The walk-through surfaces that recommendation to the user but does not recompute it.

---

## Per-finding question format

For each finding, the walk-through asks the user via the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini).

### Stem

Opens with a mode + position indicator, then the persona-produced framing, then the proposed fix and reasoning.

```
Review mode — Finding 3 of 8 (P1):

<plain-English problem statement from why_it_matters>

Proposed fix:
  <suggested_fix, as a code block when it is a diff or literal change>

<R15 conflict context line, when applicable>
```

Substitutions:

- **`why_it_matters`:** read the contributing reviewer's artifact file at `.context/compound-engineering/ce-review/{run_id}/{reviewer_name}.json` using the same `file + line_bucket(line, +/-3) + normalize(title)` matching that headless mode uses (see `SKILL.md` Stage 6 detail enrichment). When multiple reviewers flagged the merged finding, try them in the order they appear in the merged finding's reviewer list. Use the first match.
- **`suggested_fix`:** taken from the merged finding's `suggested_fix` field (merge-tier; always available without artifact lookup when set).
- **R15 conflict context line (when applicable):** when contributing reviewers implied different actions for this finding and Stage 5 step 7b broke the tie, surface that briefly. Example: `Correctness recommends Apply; Testing recommends Skip (low confidence). Agent's recommendation: Skip.` The orchestrator's recommendation — the post-tie-break value — is what the menu labels "recommended."

When no artifact match exists for the finding (merge-synthesized finding, or the persona's artifact write failed), the walk-through degrades to the finding's title plus `suggested_fix` only and records the gap for the Coverage section of the completion report.

### Options (four, or adapted as noted)

```
Apply the proposed fix
Defer — file a [TRACKER] ticket
Skip — don't apply, don't track
LFG the rest — apply the agent's best judgment to this and remaining findings
```

The `[TRACKER]` placeholder is substituted per the label logic in `tracker-defer.md` — the concrete tracker name when detection confidence is high and the sink is available, otherwise a generic form (`File a ticket`).

The menu's "recommended" option reflects the orchestrator's per-finding recommended action (post-tie-break). The question stem may label it `(recommended)` on the appropriate option label; alternately the recommendation can be surfaced in the stem's R15 conflict context line when multiple reviewers disagreed.

### Adaptations

- **Advisory-only finding:** when the finding's `autofix_class` is `advisory` (no actionable fix), option A is replaced with `Acknowledge — mark as reviewed`. The other three options remain. The advisory variant is the only case where `Acknowledge` appears in the menu.
- **N=1 (exactly one pending finding):** the stem wording shifts from `Finding N of M` to simply describing the single finding. Option D (`LFG the rest`) is suppressed because no subsequent findings exist — the menu shows three options: Apply / Defer / Skip (or Acknowledge, for advisory).
- **No-sink (Defer option unavailable):** when the tracker-detection tuple reports `any_sink_available: false` (every tier in the fallback chain — named tracker, GitHub Issues, harness primitive — is unreachable), option B (`Defer`) is omitted. The stem appends one line explaining why (e.g., `Defer unavailable on this platform — no tracker or task-tracking primitive detected.`). The menu shows three options: Apply / Skip / LFG the rest (and Acknowledge in place of Apply for advisory-only findings).
- **Combined N=1 + no-sink:** the menu shows two options: Apply / Skip (or Acknowledge / Skip).

When no blocking question tool is available on the platform, present the options as a numbered list and wait for the user's next reply.

---

## Per-finding routing

For each finding's answer:

- **Apply the proposed fix** — add the finding's id to an in-memory Apply set. Advance to the next finding. Do not dispatch the fixer inline — Apply accumulates for end-of-walk-through batch dispatch.
- **Acknowledge — mark as reviewed** (advisory variant) — record Acknowledge in the in-memory decision list. Advance to the next finding. No side effects.
- **Defer — file a [TRACKER] ticket** — invoke the tracker-defer flow from `tracker-defer.md`. The walk-through's position indicator stays on the current finding during any failure-path sub-question (Retry / Fall back / Convert to Skip). On success, record the tracker URL / reference in the in-memory decision list and advance. On conversion-to-Skip from the failure path, advance with the failure noted in the completion report.
- **Skip — don't apply, don't track** — record Skip in the in-memory decision list. Advance. No side effects.
- **LFG the rest — apply the agent's best judgment to this and remaining findings** — exit the walk-through loop. Dispatch the bulk preview from `bulk-preview.md`, scoped to the current finding and everything not yet decided. The preview header reports the count of already-decided findings ("K already decided"). If the user picks `Cancel` from the preview, return to the current finding's per-finding question (not to the routing question). If the user picks `Proceed`, execute the plan per `bulk-preview.md` — Apply findings join the in-memory Apply set with the ones the user already picked, Defer findings route through `tracker-defer.md`, Skip / Acknowledge no-op — then proceed to end-of-walk-through dispatch.

---

## Override rule

"Override" means the user picks a different preset action (Defer or Skip in place of Apply, or Apply in place of the agent's recommendation). No inline freeform custom-fix authoring — the walk-through is a decision loop, not a pair-programming surface. A user who wants a variant of the proposed fix picks Skip and hand-edits outside the flow; if they also want the finding tracked, they file a ticket manually. This trade is explicit in v1's scope boundaries.

---

## State

Walk-through state is **in-memory only**. The orchestrator maintains:

- An Apply set (finding ids the user picked Apply on)
- A decision list (every answered finding with its action and any metadata like `tracker_url` for Deferred or `reason` for Skipped)
- The current position in the findings list

Nothing is written to disk per-decision. An interrupted walk-through (user cancels the prompt, session compacts, network dies) discards all in-memory state. Defer actions that already executed remain in the tracker — those are external side effects and cannot be rolled back. Apply decisions have not been dispatched yet (they batch at end-of-walk-through), so they are cleanly lost with no code changes.

Formal cross-session resumption is out of scope for v1.

---

## End-of-walk-through dispatch

After the loop terminates — either every finding has been answered, or the user took `LFG the rest → Proceed` — the walk-through hands off to the dispatch phase:

1. **Apply set:** spawn one fixer subagent for the full accumulated Apply set. The fixer receives the set as its input queue and applies all changes in one pass against the current working tree. This preserves the existing "one fixer, consistent tree" mechanic and gives the fixer the full set at once to handle inter-fix dependencies (two Applies touching overlapping regions). The existing Step 3 fixer prompt needs a small update to acknowledge this queue may be heterogeneous (`gated_auto` and `manual` mix, not just `safe_auto`) — authored alongside this reference.
2. **Defer set:** already executed inline during the walk-through. Nothing to dispatch here.
3. **Skip / Acknowledge:** no-op.

After dispatch completes (or after `LFG the rest → Cancel` followed by the user working through remaining findings one at a time, or after the loop runs to completion), emit the unified completion report described below.

---

## Unified completion report

Every terminal path of Interactive mode emits the same completion report structure. This covers:

- Walk-through completed (all findings answered)
- Walk-through bailed via `LFG the rest → Proceed`
- Top-level LFG (routing option B) completed
- Top-level File tickets (routing option C) completed
- Zero findings after `safe_auto` (routing question was skipped — the completion summary is a one-line degenerate case of this structure)

### Minimum required fields (per R12)

- **Per-finding entries:** for every finding the flow touched, a line with — at minimum — title, severity, the action taken (Applied / Deferred / Skipped / Acknowledged), the tracker URL or in-session task reference for Deferred entries, and a one-line reason for Skipped entries (grounded in the finding's confidence or the one-line `why_it_matters` snippet).
- **Summary counts by action:** totals per bucket (e.g., `4 applied, 2 deferred, 2 skipped`).
- **Failures called out explicitly:** any fix application that failed, any ticket creation that failed (with the reason returned by the tracker). Failures are surfaced above the per-finding list so they are not missed.
- **End-of-review verdict:** the existing Stage 6 verdict (Ready to merge / Ready with fixes / Not ready), computed from the residual state after all actions complete.

### Coverage section

Carry forward the existing Coverage data (suppressed-finding count, residual risks, testing gaps, failed reviewers) and add one new element:

- **Framing-enrichment gaps:** count of findings where artifact lookup returned no match (merge-synthesized findings, or failed persona artifact writes). Name the personas contributing those gaps so the data feeds any future persona-upgrade decision. A trail of gaps per run tells the team which persona agents still need attention.

### Report ordering

The report appears after all execution completes. Ordering inside the report: failures first (above the per-finding list), then per-finding entries grouped by action bucket in the order `Applied / Deferred / Skipped / Acknowledged`, then summary counts, then Coverage, then the verdict.

### Zero-findings degenerate case

When the routing question was skipped because no `gated_auto` / `manual` findings remained after `safe_auto`, the completion report collapses to its summary-counts + verdict form with one added line — the count of `safe_auto` fixes applied. Example:

```
All findings resolved — 3 safe_auto fixes applied.

Verdict: Ready with fixes.
```

---

## Execution posture

The walk-through is operationally read-only except for two permitted writes: the in-memory Apply set / decision list (managed by the orchestrator) and the tracker-defer dispatch (external ticket creation, described in `tracker-defer.md`). Persona agents remain strictly read-only. The end-of-walk-through fixer dispatch is the single point where file modifications happen — governed by the existing Step 3 fixer contract in `SKILL.md`.
