import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { reportError, type ErrorContext } from "../src/errors"

let tmp: string
let logPath: string
let output: { system: string[] }

function makeCtx(lenient: boolean): ErrorContext {
  return {
    logPath,
    lenient,
    configPath: "/fake/config.json",
    output,
    seen: new Set(),
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "errors-test-"))
  logPath = join(tmp, "log.jsonl")
  output = { system: ["original"] }
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe("reportError fail-loud (default)", () => {
  it("prepends a SYSTEM POLICY ERROR block to output.system", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad-thing", "something went wrong")
    expect(output.system.length).toBe(2)
    expect(output.system[0]).toContain("<SYSTEM POLICY ERROR: bad-thing: something went wrong>")
    expect(output.system[1]).toBe("original")
  })

  it("writes a JSON line to the log file", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad-thing", "msg", { ruleIndex: 2 })
    expect(existsSync(logPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(logPath, "utf8").trim())
    expect(parsed.code).toBe("bad-thing")
    expect(parsed.ruleIndex).toBe(2)
  })

  it("injects the block on every call (fail-loud is persistent)", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad", "m")
    reportError(ctx, "bad", "m")
    const blocks = output.system.filter((s) => s.startsWith("<SYSTEM POLICY ERROR"))
    expect(blocks.length).toBe(2)
  })

  it("writes only one log line per unique (code,path,ruleIndex)", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad", "m", { ruleIndex: 1 })
    reportError(ctx, "bad", "m", { ruleIndex: 1 })
    const lines = readFileSync(logPath, "utf8").trim().split("\n")
    expect(lines.length).toBe(1)
  })

  it("treats different ruleIndex as different events", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad", "m", { ruleIndex: 1 })
    reportError(ctx, "bad", "m", { ruleIndex: 2 })
    const lines = readFileSync(logPath, "utf8").trim().split("\n")
    expect(lines.length).toBe(2)
  })
})

describe("reportError lenient", () => {
  it("does NOT inject into output.system", () => {
    const ctx = makeCtx(true)
    reportError(ctx, "bad", "m")
    expect(output.system).toEqual(["original"])
  })

  it("still writes to the log file", () => {
    const ctx = makeCtx(true)
    reportError(ctx, "bad", "m")
    expect(existsSync(logPath)).toBe(true)
  })
})
