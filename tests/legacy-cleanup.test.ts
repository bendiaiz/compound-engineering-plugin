import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { cleanupStaleSkillDirs, cleanupStaleAgents, cleanupStalePrompts } from "../src/utils/legacy-cleanup"

async function createDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "SKILL.md"), "placeholder")
}

async function createFile(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, "placeholder")
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

describe("cleanupStaleSkillDirs", () => {
  test("removes known stale skill directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-skills-"))
    await createDir(path.join(root, "git-commit"))
    await createDir(path.join(root, "setup"))
    await createDir(path.join(root, "document-review"))

    const removed = await cleanupStaleSkillDirs(root)

    expect(removed).toBe(3)
    expect(await exists(path.join(root, "git-commit"))).toBe(false)
    expect(await exists(path.join(root, "setup"))).toBe(false)
    expect(await exists(path.join(root, "document-review"))).toBe(false)
  })

  test("preserves non-stale directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-preserve-"))
    await createDir(path.join(root, "ce-plan"))
    await createDir(path.join(root, "ce-commit"))
    await createDir(path.join(root, "custom-user-skill"))

    const removed = await cleanupStaleSkillDirs(root)

    expect(removed).toBe(0)
    expect(await exists(path.join(root, "ce-plan"))).toBe(true)
    expect(await exists(path.join(root, "ce-commit"))).toBe(true)
    expect(await exists(path.join(root, "custom-user-skill"))).toBe(true)
  })

  test("removes ce-review and ce-document-review (renamed skills)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-renamed-"))
    await createDir(path.join(root, "ce-review"))
    await createDir(path.join(root, "ce-document-review"))

    const removed = await cleanupStaleSkillDirs(root)

    expect(removed).toBe(2)
    expect(await exists(path.join(root, "ce-review"))).toBe(false)
    expect(await exists(path.join(root, "ce-document-review"))).toBe(false)
  })

  test("returns 0 when directory does not exist", async () => {
    const removed = await cleanupStaleSkillDirs("/tmp/nonexistent-cleanup-dir-12345")
    expect(removed).toBe(0)
  })
})

describe("cleanupStaleAgents", () => {
  test("removes flat .md agent files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-agents-md-"))
    await createFile(path.join(root, "adversarial-reviewer.md"))
    await createFile(path.join(root, "learnings-researcher.md"))

    const removed = await cleanupStaleAgents(root, ".md")

    expect(removed).toBe(2)
    expect(await exists(path.join(root, "adversarial-reviewer.md"))).toBe(false)
    expect(await exists(path.join(root, "learnings-researcher.md"))).toBe(false)
  })

  test("removes .agent.md files (Copilot format)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-agents-copilot-"))
    await createFile(path.join(root, "security-sentinel.agent.md"))
    await createFile(path.join(root, "performance-oracle.agent.md"))

    const removed = await cleanupStaleAgents(root, ".agent.md")

    expect(removed).toBe(2)
    expect(await exists(path.join(root, "security-sentinel.agent.md"))).toBe(false)
  })

  test("removes agent directories when extension is null", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-agents-dir-"))
    await createDir(path.join(root, "code-simplicity-reviewer"))
    await createDir(path.join(root, "repo-research-analyst"))

    const removed = await cleanupStaleAgents(root, null)

    expect(removed).toBe(2)
    expect(await exists(path.join(root, "code-simplicity-reviewer"))).toBe(false)
    expect(await exists(path.join(root, "repo-research-analyst"))).toBe(false)
  })

  test("preserves ce-prefixed agent files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-agents-keep-"))
    await createFile(path.join(root, "ce-adversarial-reviewer.md"))
    await createFile(path.join(root, "ce-learnings-researcher.md"))

    const removed = await cleanupStaleAgents(root, ".md")

    expect(removed).toBe(0)
    expect(await exists(path.join(root, "ce-adversarial-reviewer.md"))).toBe(true)
  })
})

describe("cleanupStalePrompts", () => {
  test("removes old workflow prompt wrappers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-prompts-"))
    await createFile(path.join(root, "ce-plan.md"))
    await createFile(path.join(root, "ce-review.md"))
    await createFile(path.join(root, "ce-brainstorm.md"))

    const removed = await cleanupStalePrompts(root)

    expect(removed).toBe(3)
    expect(await exists(path.join(root, "ce-plan.md"))).toBe(false)
    expect(await exists(path.join(root, "ce-review.md"))).toBe(false)
  })

  test("preserves non-stale prompt files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-prompts-keep-"))
    await createFile(path.join(root, "my-custom-prompt.md"))
    await createFile(path.join(root, "review-command.md"))

    const removed = await cleanupStalePrompts(root)

    expect(removed).toBe(0)
    expect(await exists(path.join(root, "my-custom-prompt.md"))).toBe(true)
  })
})

describe("idempotency", () => {
  test("running cleanup twice returns 0 on second run", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-idempotent-"))
    await createDir(path.join(root, "git-commit"))
    await createFile(path.join(root, "adversarial-reviewer.md"))

    const first = await cleanupStaleSkillDirs(root) + await cleanupStaleAgents(root, ".md")
    expect(first).toBe(2)

    const second = await cleanupStaleSkillDirs(root) + await cleanupStaleAgents(root, ".md")
    expect(second).toBe(0)
  })
})
