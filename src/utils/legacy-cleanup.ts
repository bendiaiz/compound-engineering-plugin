/**
 * One-time cleanup of stale compound-engineering files from previous installs.
 *
 * The v3 rename changed all skill and agent names (e.g., git-commit -> ce-commit,
 * adversarial-reviewer -> ce-adversarial-reviewer). Target writers create new
 * files at the new paths but don't remove the old ones, leaving orphans that
 * confuse the agent runtime.
 *
 * This module lists the known old names and removes them from the target's
 * output directories. It's safe to run multiple times (idempotent) and safe
 * to remove entirely once the v2 -> v3 transition window has passed.
 *
 * TODO(cleanup): Remove this file after the v3 transition (circa Q3 2026).
 */

import fs from "fs/promises"
import path from "path"

/** Old skill directory names that no longer exist after the v3 rename. */
const STALE_SKILL_DIRS = [
  // ce: -> ce- (dirs were already hyphenated by sanitizePathName, so these
  // only collide if the old name was exactly the same after sanitization —
  // which it was for all 8 workflow skills. No orphans from this group.)

  // git-* -> ce-*
  "git-commit",
  "git-commit-push-pr",
  "git-worktree",
  "git-clean-gone-branches",

  // report-bug-ce -> ce-report-bug
  "report-bug-ce",

  // unprefixed -> ce-*
  "agent-native-architecture",
  "agent-native-audit",
  "andrew-kane-gem-writer",
  "changelog",
  "claude-permissions-optimizer",
  "deploy-docs",
  "dhh-rails-style",
  "document-review",
  "dspy-ruby",
  "every-style-editor",
  "feature-video",
  "frontend-design",
  "gemini-imagegen",
  "onboarding",
  "orchestrating-swarms",
  "proof",
  "reproduce-bug",
  "resolve-pr-feedback",
  "setup",
  "test-browser",
  "test-xcode",
  "todo-create",
  "todo-resolve",
  "todo-triage",

  // ce-review -> ce-code-review, ce-document-review -> ce-doc-review
  "ce-review",
  "ce-document-review",
]

/** Old agent names (used as generated skill dirs or flat .md files). */
const STALE_AGENT_NAMES = [
  // All 49 agents were renamed from <name> to ce-<name>
  "adversarial-document-reviewer",
  "adversarial-reviewer",
  "agent-native-reviewer",
  "ankane-readme-writer",
  "api-contract-reviewer",
  "architecture-strategist",
  "best-practices-researcher",
  "bug-reproduction-validator",
  "cli-agent-readiness-reviewer",
  "cli-readiness-reviewer",
  "code-simplicity-reviewer",
  "coherence-reviewer",
  "correctness-reviewer",
  "data-integrity-guardian",
  "data-migration-expert",
  "data-migrations-reviewer",
  "deployment-verification-agent",
  "design-implementation-reviewer",
  "design-iterator",
  "design-lens-reviewer",
  "dhh-rails-reviewer",
  "feasibility-reviewer",
  "figma-design-sync",
  "framework-docs-researcher",
  "git-history-analyzer",
  "issue-intelligence-analyst",
  "julik-frontend-races-reviewer",
  "kieran-python-reviewer",
  "kieran-rails-reviewer",
  "kieran-typescript-reviewer",
  "learnings-researcher",
  "lint",
  "maintainability-reviewer",
  "pattern-recognition-specialist",
  "performance-oracle",
  "performance-reviewer",
  "previous-comments-reviewer",
  "pr-comment-resolver",
  "product-lens-reviewer",
  "project-standards-reviewer",
  "reliability-reviewer",
  "repo-research-analyst",
  "schema-drift-detector",
  "scope-guardian-reviewer",
  "security-lens-reviewer",
  "security-reviewer",
  "security-sentinel",
  "spec-flow-analyzer",
  "testing-reviewer",
]

/** Old prompt wrapper names (we no longer generate workflow prompts). */
const STALE_PROMPT_FILES = [
  "ce-brainstorm.md",
  "ce-compound.md",
  "ce-compound-refresh.md",
  "ce-ideate.md",
  "ce-plan.md",
  "ce-review.md",
  "ce-work.md",
  "ce-work-beta.md",
]

async function removeIfExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath)
    if (stat.isDirectory()) {
      await fs.rm(targetPath, { recursive: true })
    } else {
      await fs.unlink(targetPath)
    }
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

/**
 * Remove stale skill directories from a target's skills root.
 * Call before writing new skills.
 */
export async function cleanupStaleSkillDirs(skillsRoot: string): Promise<number> {
  let removed = 0
  for (const name of STALE_SKILL_DIRS) {
    if (await removeIfExists(path.join(skillsRoot, name))) removed++
  }
  return removed
}

/**
 * Remove stale agent entries from a target's output directory.
 * Pass the file extension used by the target (e.g., ".md", ".agent.md", ".yaml").
 * For targets that write agents as skill dirs, pass null for extension.
 */
export async function cleanupStaleAgents(
  dir: string,
  extension: string | null,
): Promise<number> {
  let removed = 0
  for (const name of STALE_AGENT_NAMES) {
    const target = extension
      ? path.join(dir, `${name}${extension}`)
      : path.join(dir, name)
    if (await removeIfExists(target)) removed++
  }
  return removed
}

/**
 * Remove stale prompt wrapper files.
 * Only applies to targets that used to generate workflow prompt wrappers (Codex).
 */
export async function cleanupStalePrompts(promptsDir: string): Promise<number> {
  let removed = 0
  for (const file of STALE_PROMPT_FILES) {
    if (await removeIfExists(path.join(promptsDir, file))) removed++
  }
  return removed
}
