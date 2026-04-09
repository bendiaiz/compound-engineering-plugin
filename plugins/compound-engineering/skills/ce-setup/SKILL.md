---
name: ce-setup
description: "Diagnose and configure compound-engineering environment. Checks CLI dependencies, plugin version, and repo-local config. Offers guided installation for missing tools. Use when troubleshooting missing tools, verifying setup, or before onboarding."
disable-model-invocation: true
---

# Compound Engineering Setup

## Interaction Method

Ask the user each question below using the platform's blocking question tool (e.g., `AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). If no structured question tool is available, present each question as a numbered list and wait for a reply before proceeding. For multiSelect questions, accept comma-separated numbers (e.g. `1, 3`). Never skip or auto-configure.

Interactive setup for compound-engineering — diagnoses environment health, cleans obsolete repo-local CE config, and helps configure required tools. Review agent selection is handled automatically by `ce:review`; project-specific review guidance belongs in `CLAUDE.md` or `AGENTS.md`.

## Phase 1: Diagnose

### Step 1: Determine Plugin Version

Detect the installed compound-engineering plugin version by reading the plugin metadata or manifest. This is platform-specific -- use whatever mechanism is available (e.g., reading `plugin.json` from the plugin root or cache directory). If the version cannot be determined, skip this step.

If a version is found, pass it to the check script via `--version`. Otherwise omit the flag.

### Step 2: Run the Health Check Script

Run the bundled check script. Do not perform manual dependency checks -- the script handles all CLI tools, repo-local CE file checks, and `.gitignore` guidance in one pass.

```bash
bash scripts/check-health --version VERSION
```

Or without version if Step 1 could not determine it:

```bash
bash scripts/check-health
```

Script reference: `scripts/check-health`

Display the script's output to the user.

### Step 3: Evaluate Results

After the diagnostic report, check whether:

- any dependencies are missing (reported as red or skip in the script output)
- `compound-engineering.local.md` is present and needs cleanup
- `.compound-engineering/config.local.yaml` is not safely gitignored

If everything is installed and no repo-local CE cleanup is needed, display:

```
Environment healthy -- all dependencies found.
Review agent selection is automatic in ce:review.
Run /ce-update to check if a newer plugin version is available.
Setup complete.
```

Stop here.

If repo-local CE cleanup is needed, handle it before dependency installation.

If any installable dependencies are missing, proceed to Phase 2.

## Phase 2: Fix

### Step 4: Resolve Repo-Local CE Issues

If `compound-engineering.local.md` exists, explain that it is obsolete because review-agent selection is automatic and CE now uses `.compound-engineering/config.local.yaml` for any surviving machine-local state. Ask whether to delete it now.

If `.compound-engineering/config.local.yaml` should be machine-local in this repo and the diagnostic reported that it is not safely gitignored, offer to add this line to `.gitignore`:

```text
.compound-engineering/config.local.yaml
```

If the user approves, add the entry exactly once. If the user declines, continue after warning that the file may be committed accidentally.

### Step 5: Offer Installation

Present the missing dependencies grouped by tier using a multiSelect question. Pre-select recommended items. Use the install commands and URLs from the script's diagnostic output.

```
The following tools are missing. Select which to install:
(Recommended items are pre-selected)

Recommended:
  [x] agent-browser - Browser automation for testing and screenshots
  [x] gh - GitHub CLI for issues and PRs
  [x] jq - JSON processor

Optional:
  [ ] rtk - Token optimization CLI (60-90% savings)
```

Only show dependencies that are actually missing. Omit installed ones.

### Step 6: Install Selected Dependencies

For each selected dependency, in order:

1. **Show the install command** (from the diagnostic output) and ask for approval:

   ```
   Install agent-browser?
   Command: npm install -g agent-browser && agent-browser install

   1. Run this command
   2. Skip - I'll install it manually
   ```

2. **If approved:** Run the install command using a shell execution tool. After the command completes, verify installation by running the dependency's check command (e.g., `command -v agent-browser`).

3. **If verification succeeds:** Report success.

4. **If verification fails or install errors:** Display the project URL as fallback and continue to the next dependency.

### Step 7: Summary

Display a brief summary:

```
Dependencies configured.
  Installed: agent-browser, gh, jq
  Skipped:   rtk

Review agent selection is automatic in ce:review.
Project-specific review context belongs in CLAUDE.md or AGENTS.md.
Run /ce-update to check if a newer plugin version is available.
Run /ce-setup anytime to re-check.
```
