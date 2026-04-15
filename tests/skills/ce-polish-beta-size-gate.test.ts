import { describe, expect, test } from "bun:test"
import { promises as fs } from "fs"
import os from "os"
import path from "path"

const extractSurfaces = path.join(
  import.meta.dir,
  "..",
  "..",
  "plugins",
  "compound-engineering",
  "skills",
  "ce-polish-beta",
  "scripts",
  "extract-surfaces.sh",
)

const classifyOversized = path.join(
  import.meta.dir,
  "..",
  "..",
  "plugins",
  "compound-engineering",
  "skills",
  "ce-polish-beta",
  "scripts",
  "classify-oversized.sh",
)

const parseChecklist = path.join(
  import.meta.dir,
  "..",
  "..",
  "plugins",
  "compound-engineering",
  "skills",
  "ce-polish-beta",
  "scripts",
  "parse-checklist.sh",
)

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
}

type RunResult = {
  exitCode: number
  stdout: string
  stderr: string
}

async function runCommand(cmd: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: gitEnv,
    stderr: "pipe",
    stdout: "pipe",
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  return { exitCode, stdout, stderr }
}

async function initRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ce-polish-size-"))
  await runCommand(["git", "init", "-b", "main"], root)
  return root
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const full = path.join(root, rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content)
}

async function commitAll(root: string, message: string): Promise<void> {
  await runCommand(["git", "add", "-A"], root)
  await runCommand(["git", "commit", "-m", message], root)
}

async function setupRepoWithBase(root: string): Promise<void> {
  await writeFile(root, "README.md", "# repo\n")
  await commitAll(root, "initial")
}

describe("extract-surfaces.sh", () => {
  test("emits [] for empty diff", async () => {
    const repo = await initRepo()
    await setupRepoWithBase(repo)
    const result = await runCommand(["bash", extractSurfaces, "main"], repo)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe("[]")
  })

  test("classifies files across multiple surfaces", async () => {
    const repo = await initRepo()
    await setupRepoWithBase(repo)
    await runCommand(["git", "checkout", "-b", "feat"], repo)

    await writeFile(repo, "app/views/users/show.html.erb", "<h1>hi</h1>\n")
    await writeFile(repo, "app/controllers/users_controller.rb", "class UsersController; end\n")
    await writeFile(repo, "app/models/user.rb", "class User; end\n")
    await writeFile(repo, "spec/models/user_spec.rb", "describe User do; end\n")
    await writeFile(repo, "config/routes.rb", "Rails.application.routes.draw do; end\n")
    await commitAll(repo, "add files")

    const result = await runCommand(["bash", extractSurfaces, "main"], repo)
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed).toHaveLength(5)

    const bySurface: Record<string, string[]> = {}
    for (const entry of parsed) {
      bySurface[entry.surface] ??= []
      bySurface[entry.surface]!.push(entry.file)
    }

    expect(bySurface.view).toEqual(["app/views/users/show.html.erb"])
    expect(bySurface.controller).toEqual(["app/controllers/users_controller.rb"])
    expect(bySurface.model).toEqual(["app/models/user.rb"])
    expect(bySurface.test).toEqual(["spec/models/user_spec.rb"])
    expect(bySurface.config).toEqual(["config/routes.rb"])
  })

  test("test files take precedence over their component surface", async () => {
    const repo = await initRepo()
    await setupRepoWithBase(repo)
    await runCommand(["git", "checkout", "-b", "feat"], repo)

    // An _spec.rb file inside app/views should still classify as test, not view
    await writeFile(repo, "app/views/users/show_spec.rb", "# spec\n")
    await commitAll(repo, "add spec-in-views")

    const result = await runCommand(["bash", extractSurfaces, "main"], repo)
    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed).toHaveLength(1)
    expect(parsed[0].surface).toBe("test")
  })
})

describe("classify-oversized.sh", () => {
  test("returns manageable for small single-surface diff", async () => {
    const repo = await initRepo()
    await setupRepoWithBase(repo)
    await runCommand(["git", "checkout", "-b", "feat"], repo)

    await writeFile(repo, "app/views/home.html.erb", "<h1>hello</h1>\n")
    await commitAll(repo, "small change")

    const fileList = JSON.stringify([
      { file: "app/views/home.html.erb", surface: "view" },
    ])

    const result = await runCommand(
      ["bash", classifyOversized, "main", fileList],
      repo,
    )
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed.status).toBe("manageable")
    expect(parsed.reason).toBe("")
    expect(parsed.file_count).toBe(1)
    expect(parsed.surface_count).toBe(1)
    expect(parsed.diff_lines).toBeGreaterThan(0)
  })

  test("returns oversized when file_count > 5", async () => {
    const repo = await initRepo()
    await setupRepoWithBase(repo)
    await runCommand(["git", "checkout", "-b", "feat"], repo)

    const files: { file: string; surface: string }[] = []
    for (let i = 0; i < 6; i++) {
      const p = `app/views/page_${i}.html.erb`
      await writeFile(repo, p, `<h1>page ${i}</h1>\n`)
      files.push({ file: p, surface: "view" })
    }
    await commitAll(repo, "many view files")

    const result = await runCommand(
      ["bash", classifyOversized, "main", JSON.stringify(files)],
      repo,
    )
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed.status).toBe("oversized")
    expect(parsed.reason).toBe("file_count > 5")
    expect(parsed.file_count).toBe(6)
    expect(parsed.surface_count).toBe(1)
  })

  test("returns oversized when surface_count > 2", async () => {
    const repo = await initRepo()
    await setupRepoWithBase(repo)
    await runCommand(["git", "checkout", "-b", "feat"], repo)

    await writeFile(repo, "app/views/a.html.erb", "<h1>a</h1>\n")
    await writeFile(repo, "app/controllers/a_controller.rb", "class A; end\n")
    await writeFile(repo, "app/models/a.rb", "class AM; end\n")
    await commitAll(repo, "three surfaces")

    const files = [
      { file: "app/views/a.html.erb", surface: "view" },
      { file: "app/controllers/a_controller.rb", surface: "controller" },
      { file: "app/models/a.rb", surface: "model" },
    ]

    const result = await runCommand(
      ["bash", classifyOversized, "main", JSON.stringify(files)],
      repo,
    )
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed.status).toBe("oversized")
    expect(parsed.reason).toBe("surface_count > 2")
    expect(parsed.surface_count).toBe(3)
  })

  test("returns oversized when diff_lines > 300", async () => {
    const repo = await initRepo()
    await setupRepoWithBase(repo)
    await runCommand(["git", "checkout", "-b", "feat"], repo)

    // 400 lines of content in a single file
    const content = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n") + "\n"
    await writeFile(repo, "app/views/big.html.erb", content)
    await commitAll(repo, "big file")

    const files = [{ file: "app/views/big.html.erb", surface: "view" }]

    const result = await runCommand(
      ["bash", classifyOversized, "main", JSON.stringify(files)],
      repo,
    )
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed.status).toBe("oversized")
    expect(parsed.reason).toBe("diff_lines > 300")
    expect(parsed.diff_lines).toBeGreaterThan(300)
  })

  test("errors on missing arguments", async () => {
    const repo = await initRepo()
    const result = await runCommand(["bash", classifyOversized], repo)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("usage:")
  })
})

describe("parse-checklist.sh", () => {
  async function writeChecklist(repo: string, content: string): Promise<string> {
    const p = path.join(repo, "checklist.md")
    await fs.writeFile(p, content)
    return p
  }

  test("parses a single well-formed manageable item", async () => {
    const repo = await initRepo()
    const content = `# Polish checklist

## Item 1 — Polish the avatar fallback
- action: fix
- files: app/views/users/_avatar.html.erb
- surface: view
- status: manageable
- notes: The fallback renders a broken image when the URL is nil.
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: 1,
      title: "Polish the avatar fallback",
      action: "fix",
      files: ["app/views/users/_avatar.html.erb"],
      surface: "view",
      status: "manageable",
    })
    expect(parsed[0].notes).toContain("broken image")
  })

  test("parses multi-line notes block via pipe syntax", async () => {
    const repo = await initRepo()
    const content = `## Item 1 — Something
- action: fix
- files: a.rb
- surface: model
- status: manageable
- notes: |
  first line
  second line

  fourth line after blank
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed).toHaveLength(1)
    expect(parsed[0].notes).toContain("first line")
    expect(parsed[0].notes).toContain("second line")
    expect(parsed[0].notes).toContain("fourth line after blank")
  })

  test("parses comma-separated files list with whitespace", async () => {
    const repo = await initRepo()
    const content = `## Item 1 — Multi-file polish
- action: fix
- files: app/views/a.erb,  app/views/b.erb  , app/views/c.erb
- surface: view
- status: manageable
- notes: Trim all three.
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed[0].files).toEqual([
      "app/views/a.erb",
      "app/views/b.erb",
      "app/views/c.erb",
    ])
  })

  test("parses multiple items in order", async () => {
    const repo = await initRepo()
    const content = `## Item 1 — First
- action: fix
- files: a.rb
- surface: model
- status: manageable
- notes: n1

## Item 2 — Second
- action: keep
- files: b.rb
- surface: test
- status: manageable
- notes: n2

## Item 3 — Third
- action: stacked
- files: c.rb,d.rb,e.rb,f.rb,g.rb,h.rb
- surface: model
- status: oversized
- notes: n3
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed).toHaveLength(3)
    expect(parsed[0].id).toBe(1)
    expect(parsed[1].id).toBe(2)
    expect(parsed[2].id).toBe(3)
    expect(parsed[2].action).toBe("stacked")
    expect(parsed[2].status).toBe("oversized")
  })

  test("rejects unknown action values", async () => {
    const repo = await initRepo()
    const content = `## Item 1 — Bogus
- action: yolo
- files: a.rb
- surface: model
- status: manageable
- notes: oops
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("unknown action 'yolo'")
  })

  test("rejects unknown status values", async () => {
    const repo = await initRepo()
    const content = `## Item 1 — Bad status
- action: fix
- files: a.rb
- surface: model
- status: enormous
- notes: oops
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("unknown status 'enormous'")
  })

  test("rejects oversized item with action other than stacked", async () => {
    const repo = await initRepo()
    const content = `## Item 1 — Tried to fix oversized
- action: fix
- files: a.rb
- surface: model
- status: oversized
- notes: user tried to smuggle
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("oversized")
    expect(result.stderr).toContain("stacked")
  })

  test("accepts user-elevated stacked action on manageable items", async () => {
    // SKILL.md Phase 4.9 explicitly allows `action: stacked` on manageable
    // items as user elevation — the user judges an item too big even though
    // the classifier missed it. The per-item stacked seed is rewritten with
    // `user_judgment: yes` downstream. The parser must not reject this shape.
    const repo = await initRepo()
    const content = `## Item 1 — User elevates a manageable item
- action: stacked
- files: a.rb
- surface: model
- status: manageable
- notes: user judged this too big despite classifier saying manageable
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed).toHaveLength(1)
    expect(parsed[0].action).toBe("stacked")
    expect(parsed[0].status).toBe("manageable")
  })

  test("notes-block terminator line is re-dispatched as a field", async () => {
    // Regression test for the bug where a notes block terminated by a
    // field-shaped line silently dropped that line. If the user forgets to
    // indent continuation lines, a later `- action: skip` would close the
    // block and then be discarded, leaving the prior action in place AND
    // losing the skip intent. The parser now re-dispatches the terminator
    // through the field parser so the user's intent is preserved.
    const repo = await initRepo()
    const content = `## Item 1 — Notes then more fields
- action: fix
- notes: |
  first prose line
- files: a.rb,b.rb
- surface: view
- status: manageable
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed).toHaveLength(1)
    expect(parsed[0].action).toBe("fix")
    // The terminator line (`- files: a.rb,b.rb`) would have been silently
    // dropped before the fix, leaving files empty.
    expect(parsed[0].files).toEqual(["a.rb", "b.rb"])
    expect(parsed[0].surface).toBe("view")
    expect(parsed[0].status).toBe("manageable")
    expect(parsed[0].notes).toContain("first prose line")
  })

  test("accepts em-dash in item header", async () => {
    const repo = await initRepo()
    const content = `## Item 1 — With em-dash
- action: keep
- files: a.rb
- surface: other
- status: manageable
- notes: ok
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed[0].title).toBe("With em-dash")
  })

  test("accepts hyphen in item header", async () => {
    const repo = await initRepo()
    const content = `## Item 1 - With hyphen
- action: keep
- files: a.rb
- surface: other
- status: manageable
- notes: ok
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed[0].title).toBe("With hyphen")
  })

  test("emits empty array for file with no items", async () => {
    const repo = await initRepo()
    const content = `# Polish checklist

No items yet.
`
    const checklistPath = await writeChecklist(repo, content)

    const result = await runCommand(["bash", parseChecklist, checklistPath], repo)
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual([])
  })

  test("errors on missing file argument", async () => {
    const repo = await initRepo()
    const result = await runCommand(["bash", parseChecklist], repo)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("usage:")
  })
})
