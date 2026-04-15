import { describe, expect, test } from "bun:test"
import { promises as fs } from "fs"
import path from "path"

// These tests assert that ce-polish-beta/SKILL.md documents the envelope
// shape and artifact layout that downstream callers (LFG, future chains)
// rely on. The skill body itself is markdown the model interprets, so the
// contract we can check here is: "is the documented shape present, exact,
// and byte-stable across edits?".

const SKILL_PATH = path.join(
  import.meta.dir,
  "..",
  "..",
  "plugins",
  "compound-engineering",
  "skills",
  "ce-polish-beta",
  "SKILL.md",
)

let cachedSkill: string | null = null
async function readSkill(): Promise<string> {
  if (cachedSkill !== null) return cachedSkill
  cachedSkill = await fs.readFile(SKILL_PATH, "utf8")
  return cachedSkill
}

describe("ce:polish-beta SKILL.md envelope", () => {
  test("frontmatter declares ce:polish-beta with beta disable-model-invocation", async () => {
    const skill = await readSkill()
    expect(skill).toMatch(/^---\nname: ce:polish-beta\n/)
    expect(skill).toContain("disable-model-invocation: true")
    expect(skill).toContain('description: "[BETA]')
  })

  test("interactive completion envelope includes all required fields", async () => {
    const skill = await readSkill()
    const required = [
      "Polish complete.",
      "Scope:",
      "Review artifact:",
      "Dev server:",
      "IDE browser:",
      "Checklist items:",
      "Stacked PRs:",
      "Replan seed:",
      "Escalation:",
      "Artifact:",
      "Next:",
    ]
    for (const field of required) {
      expect(skill).toContain(field)
    }
  })

  test("headless completion envelope mirrors ce:review shape", async () => {
    const skill = await readSkill()
    // The headless header distinguishes headless mode
    expect(skill).toContain("Polish complete (headless mode).")
    // Both modes terminate with the literal `Polish complete` signal
    expect(skill).toMatch(/\nPolish complete\n/)
  })

  test("error envelope pattern is documented", async () => {
    const skill = await readSkill()
    expect(skill).toContain("Polish failed (headless mode). Reason: <reason>. <remediation>.")
  })

  test("error envelope examples cover conflicting mode and no-target cases", async () => {
    const skill = await readSkill()
    expect(skill).toContain("conflicting or unknown mode flags")
    expect(skill).toContain("no target — provide a PR number")
  })

  test("artifact layout includes all six canonical files", async () => {
    const skill = await readSkill()
    const files = [
      "checklist.md",
      "dispatch-log.json",
      "server.log",
      "summary.md",
      "stacked-pr-1.md",
      "replan-seed.md",
    ]
    for (const f of files) {
      expect(skill).toContain(f)
    }
  })

  test("artifact directory path uses .context/compound-engineering/ce-polish/<run-id>/", async () => {
    const skill = await readSkill()
    expect(skill).toContain(".context/compound-engineering/ce-polish/")
    expect(skill).toMatch(/\.context\/compound-engineering\/ce-polish\/<run[-_]?id>\//)
  })

  test("argument table documents all v1 tokens", async () => {
    const skill = await readSkill()
    const tokens = [
      "mode:headless",
      "trust-fork:1",
      "accept-stale-review:1",
      "allow-port-kill:1",
      "plan:<path>",
    ]
    for (const token of tokens) {
      expect(skill).toContain(token)
    }
  })

  test("five phases are present and numbered", async () => {
    const skill = await readSkill()
    expect(skill).toContain("## Phase 0: Input Triage")
    expect(skill).toContain("## Phase 1: Branch / PR Acquisition")
    expect(skill).toContain("## Phase 2: Entry Gate")
    expect(skill).toContain("## Phase 3: Dev-Server Lifecycle")
    expect(skill).toContain("## Phase 4: Checklist + Size Gate + Dispatch")
    expect(skill).toContain("## Phase 5: Envelope, Artifact, and Workflow Stitching")
  })

  test("dispatch matrix and checklist template are referenced via backtick paths", async () => {
    const skill = await readSkill()
    expect(skill).toContain("`references/checklist-template.md`")
    expect(skill).toContain("`references/subagent-dispatch-matrix.md`")
    expect(skill).toContain("`references/stacked-pr-seed-template.md`")
    expect(skill).toContain("`references/replan-seed-template.md`")
  })

  test("scripts are referenced via backtick paths, never @-inline", async () => {
    const skill = await readSkill()
    expect(skill).toContain("`scripts/read-launch-json.sh`")
    expect(skill).toContain("`scripts/detect-project-type.sh`")
    expect(skill).toContain("`scripts/extract-surfaces.sh`")
    expect(skill).toContain("`scripts/classify-oversized.sh`")
    expect(skill).toContain("`scripts/parse-checklist.sh`")

    // @-inline of an executable script would break it — assert we are not
    // doing that for any of the five scripts. @-inline has the shape
    // "@./scripts/<name>" or "@scripts/<name>" on its own line.
    expect(skill).not.toMatch(/^@\.?\/?scripts\/[a-z-]+\.sh$/m)
  })

  test("workflow stitching describes ce:review -> polish -> merge position", async () => {
    const skill = await readSkill()
    expect(skill).toContain("/ce:review")
    expect(skill).toContain("/ce:polish-beta")
    // The workflow block must mention stacked-pr seed handoff
    expect(skill).toContain("stacked-pr")
  })
})

describe("ce:polish-beta reference file catalog", () => {
  const REFERENCES_DIR = path.join(
    import.meta.dir,
    "..",
    "..",
    "plugins",
    "compound-engineering",
    "skills",
    "ce-polish-beta",
    "references",
  )

  test("all referenced template files exist on disk", async () => {
    const files = [
      "checklist-template.md",
      "subagent-dispatch-matrix.md",
      "stacked-pr-seed-template.md",
      "replan-seed-template.md",
      "launch-json-schema.md",
      "ide-detection.md",
      "dev-server-detection.md",
      "dev-server-rails.md",
      "dev-server-next.md",
      "dev-server-vite.md",
      "dev-server-procfile.md",
      "resolve-base.sh",
    ]
    for (const f of files) {
      const stat = await fs.stat(path.join(REFERENCES_DIR, f))
      expect(stat.isFile()).toBe(true)
    }
  })

  test("checklist-template.md documents the six allowed actions", async () => {
    const content = await fs.readFile(
      path.join(REFERENCES_DIR, "checklist-template.md"),
      "utf8",
    )
    for (const action of ["keep", "skip", "fix", "note", "stacked", "replan"]) {
      expect(content).toContain(`\`${action}\``)
    }
  })

  test("stacked-pr-seed-template.md pins frontmatter fields", async () => {
    const content = await fs.readFile(
      path.join(REFERENCES_DIR, "stacked-pr-seed-template.md"),
      "utf8",
    )
    expect(content).toContain("source_run:")
    expect(content).toContain("source_branch:")
    expect(content).toContain("source_head_sha:")
    expect(content).toContain("item_id:")
  })

  test("replan-seed-template.md documents all three triggers", async () => {
    const content = await fs.readFile(
      path.join(REFERENCES_DIR, "replan-seed-template.md"),
      "utf8",
    )
    expect(content).toContain("majority_oversized")
    expect(content).toContain("replan_actions")
    expect(content).toContain("batch_diff_preemptive")
  })

  test("subagent-dispatch-matrix.md uses fully qualified agent namespaces", async () => {
    const content = await fs.readFile(
      path.join(REFERENCES_DIR, "subagent-dispatch-matrix.md"),
      "utf8",
    )
    const fullyQualified = content.match(
      /compound-engineering:[a-z-]+:[a-z-]+/g,
    )
    expect(fullyQualified).not.toBeNull()
    expect(fullyQualified!.length).toBeGreaterThanOrEqual(5)
  })
})

describe("ce:polish-beta script catalog", () => {
  const SCRIPTS_DIR = path.join(
    import.meta.dir,
    "..",
    "..",
    "plugins",
    "compound-engineering",
    "skills",
    "ce-polish-beta",
    "scripts",
  )

  test("all five scripts exist and are executable", async () => {
    const files = [
      "read-launch-json.sh",
      "detect-project-type.sh",
      "extract-surfaces.sh",
      "classify-oversized.sh",
      "parse-checklist.sh",
    ]
    for (const f of files) {
      const stat = await fs.stat(path.join(SCRIPTS_DIR, f))
      expect(stat.isFile()).toBe(true)
      // Owner execute bit
      expect(stat.mode & 0o100).toBe(0o100)
    }
  })
})
