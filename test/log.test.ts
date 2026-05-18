import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { writeLog } from "../src/log"

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "log-test-"))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe("writeLog", () => {
  it("appends a JSON line to the log file", () => {
    const logPath = join(tmp, "log.jsonl")
    writeLog(logPath, {
      timestamp: "2026-05-18T00:00:00.000Z",
      code: "test-code",
      message: "test message",
    })
    const content = readFileSync(logPath, "utf8")
    expect(content.endsWith("\n")).toBe(true)
    const parsed = JSON.parse(content.trim())
    expect(parsed.code).toBe("test-code")
    expect(parsed.message).toBe("test message")
  })

  it("creates parent directories if missing", () => {
    const logPath = join(tmp, "nested", "deep", "log.jsonl")
    writeLog(logPath, {
      timestamp: "2026-05-18T00:00:00.000Z",
      code: "x",
      message: "y",
    })
    expect(existsSync(logPath)).toBe(true)
  })

  it("appends multiple entries", () => {
    const logPath = join(tmp, "log.jsonl")
    writeLog(logPath, { timestamp: "t1", code: "a", message: "1" })
    writeLog(logPath, { timestamp: "t2", code: "b", message: "2" })
    const lines = readFileSync(logPath, "utf8").trim().split("\n")
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!).code).toBe("a")
    expect(JSON.parse(lines[1]!).code).toBe("b")
  })

  it("does not throw when log path is unwritable", () => {
    // Use a path that points through a file, which can't be a parent directory.
    const blocker = join(tmp, "blocker")
    require("node:fs").writeFileSync(blocker, "x")
    const bad = join(blocker, "log.jsonl")
    expect(() => writeLog(bad, { timestamp: "t", code: "c", message: "m" })).not.toThrow()
  })
})
