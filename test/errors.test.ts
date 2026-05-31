import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { reportError, flushErrors, type ErrorContext } from "../src/errors"

let tmp: string
let logPath: string
let output: { system: string[] }
let errSpy: ReturnType<typeof spyOn>

function makeCtx(lenient: boolean): ErrorContext {
  return {
    logPath,
    lenient,
    configPath: "/fake/config.json",
    output,
    seen: new Set(),
    pendingBlocks: [],
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "errors-test-"))
  logPath = join(tmp, "log.jsonl")
  output = { system: ["original"] }
  errSpy = spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  errSpy.mockRestore()
})

describe("reportError fail-loud (default)", () => {
  it("prepends a SYSTEM POLICY ERROR block to output.system", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad-thing", "something went wrong")
    flushErrors(ctx)
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
    flushErrors(ctx)
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
    flushErrors(ctx)
    expect(output.system).toEqual(["original"])
  })

  it("still writes to the log file", () => {
    const ctx = makeCtx(true)
    reportError(ctx, "bad", "m")
    expect(existsSync(logPath)).toBe(true)
  })
})

describe("reportError stderr reporting", () => {
  it("emits one structured console.error line in fail-loud mode", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "rule-invalid", "unknown mode: foo", { ruleIndex: 2 })
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0]![0]).toBe(
      '[opencode-sysprompt-override] error code=rule-invalid ruleIndex=2 ' +
        'path=/fake/config.json msg="unknown mode: foo"',
    )
  })

  it("emits the stderr line in lenient mode too (reporting is independent of lenient)", () => {
    const ctx = makeCtx(true)
    reportError(ctx, "rule-invalid", "bad", { ruleIndex: 0 })
    flushErrors(ctx)
    // lenient suppresses the SYSTEM POLICY ERROR block...
    expect(output.system).toEqual(["original"])
    // ...but the stderr line is still emitted
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0]![0]).toContain(
      "[opencode-sysprompt-override] error code=rule-invalid",
    )
  })

  it("renders '-' for missing ruleIndex and path", () => {
    const ctx = makeCtx(false)
    ctx.configPath = undefined
    reportError(ctx, "config-malformed", "bad json")
    const line = errSpy.mock.calls[0]![0] as string
    expect(line).toContain("ruleIndex=-")
    expect(line).toContain("path=-")
  })

  it("collapses newlines/tabs and escapes quotes to keep the line single", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "config-malformed", 'line1\nline2\tend "quoted"')
    const line = errSpy.mock.calls[0]![0] as string
    expect(line.split("\n").length).toBe(1)
    expect(line).toContain('msg="line1 line2 end \\"quoted\\""')
  })

  it("escapes backslashes so a trailing backslash can't break out of the msg field", () => {
    const ctx = makeCtx(false)
    // A message ending in a lone backslash: without escaping `\`, the closing
    // quote of msg="…" would become `\"` (an escaped quote), letting the field
    // bleed into spurious key=value tokens. Doubling backslashes prevents it.
    reportError(ctx, "config-malformed", "win path C:\\tmp\\")
    const line = errSpy.mock.calls[0]![0] as string
    expect(line).toContain('msg="win path C:\\\\tmp\\\\"')
    // Sanity: a combined backslash+quote message round-trips unambiguously.
    const ctx2 = makeCtx(false)
    reportError(ctx2, "config-malformed", 'a\\"b')
    const line2 = errSpy.mock.calls[1]![0] as string
    expect(line2).toContain('msg="a\\\\\\"b"')
  })

  it("emits only one stderr line per unique (code,path,ruleIndex)", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "rule-invalid", "m", { ruleIndex: 1 })
    reportError(ctx, "rule-invalid", "m", { ruleIndex: 1 })
    expect(errSpy).toHaveBeenCalledTimes(1)
  })
})

describe("flushErrors deferred injection", () => {
  it("error block survives a subsequent replace mutation on output.system (fail-loud)", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad", "m")
    // Simulate a `replace` rule wiping output.system
    ctx.output.system.splice(0, ctx.output.system.length, "REPLACEMENT")
    // Then flush — error block must still appear
    flushErrors(ctx)
    expect(output.system[0]).toContain("<SYSTEM POLICY ERROR")
    expect(output.system).toContain("REPLACEMENT")
  })
})
