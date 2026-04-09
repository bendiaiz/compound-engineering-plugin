import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { promises as fs } from "fs"
import path from "path"
import os from "os"

const SCRIPT = path.join(
  process.cwd(),
  "plugins",
  "compound-engineering",
  "skills",
  "evidence-capture",
  "scripts",
  "capture-evidence.sh",
)

async function run(
  ...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { exitCode, stdout, stderr }
}

/** Create a minimal valid PNG (1x1 pixel, solid color). */
function createTestPng(color: [number, number, number]): Buffer {
  // Minimal 1x1 RGBA PNG
  const [r, g, b] = color

  // Raw RGBA pixel data: 1 row, filter byte 0, then RGBA
  const rawData = Buffer.from([0, r, g, b, 255])

  // Deflate the raw data (zlib wrapper)
  const deflated = Bun.deflateSync(rawData, { level: 0 })
  // Wrap in zlib format: CMF + FLG + deflated + adler32
  const cmf = 0x78
  const flg = 0x01
  // Compute adler32 of rawData
  let s1 = 1
  let s2 = 0
  for (const byte of rawData) {
    s1 = (s1 + byte) % 65521
    s2 = (s2 + s1) % 65521
  }
  const adler32 = Buffer.alloc(4)
  adler32.writeUInt32BE((s2 << 16) | s1)

  const zlibData = Buffer.concat([Buffer.from([cmf, flg]), deflated, adler32])

  // Build PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeB = Buffer.from(type, "ascii")
    const body = Buffer.concat([typeB, data])
    const crc = crc32(body)
    const crcB = Buffer.alloc(4)
    crcB.writeUInt32BE(crc >>> 0)
    return Buffer.concat([len, body, crcB])
  }

  // IHDR: 1x1, 8-bit RGBA
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0) // width
  ihdr.writeUInt32BE(1, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const idat = zlibData
  const iend = Buffer.alloc(0)

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", iend),
  ])
}

/** CRC32 for PNG chunk checksums. */
function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// --- Error path tests (no dependencies needed) ---

describe("capture-evidence.sh", () => {
  describe("usage and arg validation", () => {
    test("no subcommand prints usage and exits 1", async () => {
      const { exitCode, stdout } = await run()
      expect(exitCode).toBe(1)
      expect(stdout).toContain("Commands:")
      expect(stdout).toContain("stitch")
      expect(stdout).toContain("upload")
    })

    test("stitch with no args fails with usage", async () => {
      const { exitCode, stderr } = await run("stitch")
      expect(exitCode).toBe(1)
      expect(stderr).toContain("Usage: stitch")
    })

    test("stitch with output but no frames fails", async () => {
      const { exitCode, stderr } = await run("stitch", "out.gif")
      expect(exitCode).toBe(1)
      expect(stderr).toContain("No input frames")
    })

    test("stitch fails on missing frame file", async () => {
      const { exitCode, stderr } = await run(
        "stitch",
        "out.gif",
        "/tmp/nonexistent-frame-abc123.png",
      )
      expect(exitCode).toBe(1)
      expect(stderr).toContain("Frame not found")
    })

    test("upload fails on missing file", async () => {
      const { exitCode, stderr } = await run(
        "upload",
        "/tmp/nonexistent-file-abc123.gif",
      )
      expect(exitCode).toBe(1)
      expect(stderr).toContain("File not found")
    })
  })

  // --- Integration tests (require ffmpeg) ---

  describe("stitch integration", () => {
    let tmpDir: string
    let hasFFmpeg: boolean

    beforeAll(async () => {
      // Check for ffmpeg
      const proc = Bun.spawn(["which", "ffmpeg"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      hasFFmpeg = (await proc.exited) === 0

      if (!hasFFmpeg) return

      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-test-"))

      // Write test PNG frames
      const red = createTestPng([255, 0, 0])
      const green = createTestPng([0, 255, 0])
      const blue = createTestPng([0, 0, 255])

      await fs.writeFile(path.join(tmpDir, "frame1.png"), red)
      await fs.writeFile(path.join(tmpDir, "frame2.png"), green)
      await fs.writeFile(path.join(tmpDir, "frame3.png"), blue)
    })

    afterAll(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })

    test("stitches frames into a GIF", async () => {
      if (!hasFFmpeg) {
        console.log("Skipping: ffmpeg not available")
        return
      }

      const output = path.join(tmpDir, "output.gif")
      const { exitCode, stdout } = await run(
        "stitch",
        "--duration",
        "0.5",
        output,
        path.join(tmpDir, "frame1.png"),
        path.join(tmpDir, "frame2.png"),
      )

      expect(exitCode).toBe(0)
      expect(stdout).toContain("Stitching 2 frames")
      expect(stdout).toContain("Created:")

      // Verify GIF exists and has content
      const stat = await fs.stat(output)
      expect(stat.size).toBeGreaterThan(0)

      // Verify it starts with GIF magic bytes
      const header = Buffer.alloc(6)
      const fh = await fs.open(output, "r")
      await fh.read(header, 0, 6)
      await fh.close()
      expect(header.toString("ascii").startsWith("GIF")).toBe(true)
    })

    test("stitches 3 frames into a GIF", async () => {
      if (!hasFFmpeg) {
        console.log("Skipping: ffmpeg not available")
        return
      }

      const output = path.join(tmpDir, "output3.gif")
      const { exitCode, stdout } = await run(
        "stitch",
        "--duration",
        "0.5",
        output,
        path.join(tmpDir, "frame1.png"),
        path.join(tmpDir, "frame2.png"),
        path.join(tmpDir, "frame3.png"),
      )

      expect(exitCode).toBe(0)
      expect(stdout).toContain("Stitching 3 frames")
    })

    test("default duration is used when --duration not specified", async () => {
      if (!hasFFmpeg) {
        console.log("Skipping: ffmpeg not available")
        return
      }

      const output = path.join(tmpDir, "output-default-dur.gif")
      const { exitCode, stdout } = await run(
        "stitch",
        output,
        path.join(tmpDir, "frame1.png"),
        path.join(tmpDir, "frame2.png"),
      )

      expect(exitCode).toBe(0)
      // Should use default 3.0s duration — just verify it succeeds
      expect(stdout).toContain("Created:")
    })
  })
})
