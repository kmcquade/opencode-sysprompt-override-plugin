import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import * as os from "node:os"
import { tmpdir } from "node:os"
import { clearCache } from "../src/config"
import plugin from "../src/index"

let tmp: string
let opencodeDir: string
let configPath: string
let logPath: string
let errSpy: ReturnType<typeof spyOn>
// Sandbox home so the plugin's global config candidates can't pick up a real
// ~/.config/opencode/system-prompts.json on a developer's machine.
let fakeHome: string
let homedirSpy: ReturnType<typeof spyOn>

function stderrLines(): string[] {
  return errSpy.mock.calls.map((c) => String(c[0]))
}

const qwen = {
  providerID: "openrouter",
  id: "qwen3-coder",
  api: { id: "qwen3-coder", url: "", npm: "" },
  name: "Qwen3 Coder",
  capabilities: {},
}

const claude = {
  providerID: "anthropic",
  id: "claude-sonnet-4-6",
  api: { id: "claude-sonnet-4-6", url: "", npm: "" },
  name: "Claude",
  capabilities: {},
}

function fakeCtx(directory: string) {
  return {
    client: {} as unknown,
    project: {} as unknown,
    directory,
    worktree: directory,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost"),
    $: {} as unknown,
  } as any
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "integration-test-"))
  fakeHome = mkdtempSync(join(tmpdir(), "integration-test-home-"))
  homedirSpy = spyOn(os, "homedir").mockReturnValue(fakeHome)
  opencodeDir = join(tmp, ".opencode")
  mkdirSync(opencodeDir, { recursive: true })
  configPath = join(opencodeDir, "system-prompts.json")
  logPath = join(opencodeDir, "system-prompt-override.log")
  clearCache()
  delete process.env.OPENCODE_SYSTEM_PROMPT_CONFIG
  errSpy = spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
  homedirSpy.mockRestore()
  clearCache()
  errSpy.mockRestore()
})

describe("plugin end-to-end", () => {
  it("happy path: explicit qwen rule applies, default skipped", async () => {
    writeFileSync(configPath, JSON.stringify({
      default: { mode: "append", prompt: "DEFAULT" },
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", prompt: "QWEN-OVERRIDE" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system).toEqual(["QWEN-OVERRIDE"])
  })

  it("default fires when no explicit rule matched", async () => {
    writeFileSync(configPath, JSON.stringify({
      default: { mode: "append", prompt: "DEFAULT" },
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", prompt: "QWEN" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: claude } as any,
      output,
    )
    expect(output.system).toEqual(["original", "DEFAULT"])
  })

  it("replace then append: both apply in declared order", async () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", prompt: "REPLACED" },
        { match: {}, mode: "append", prompt: "APPENDED" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system).toEqual(["REPLACED", "APPENDED"])
  })

  it("fail-loud: missing promptFile injects error block and writes log", async () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", promptFile: "./missing.md" },
        { match: {}, mode: "append", prompt: "VALID" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system[0]).toContain("<SYSTEM POLICY ERROR")
    expect(output.system).toContain("VALID")
    expect(existsSync(logPath)).toBe(true)
    const entry = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n")[0]!)
    expect(entry.code).toBe("promptfile-error")
    expect(entry.ruleIndex).toBe(0)
    // The same error is also surfaced to stderr as one structured line.
    const line = stderrLines().find((l) => l.includes("code=promptfile-error"))
    expect(line).toBeDefined()
    expect(line).toContain("[opencode-sysprompt-override] error")
    expect(line).toContain("ruleIndex=0")
    expect(line).toContain(`path=${configPath}`)
  })

  it("lenient: missing promptFile skips silently but still logs", async () => {
    writeFileSync(configPath, JSON.stringify({
      lenient: true,
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", promptFile: "./missing.md" },
        { match: {}, mode: "append", prompt: "VALID" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system.some((s) => s.startsWith("<SYSTEM POLICY ERROR"))).toBe(false)
    expect(output.system).toContain("VALID")
    expect(existsSync(logPath)).toBe(true)
    // Lenient suppresses the block but NOT the stderr report.
    expect(stderrLines().some((l) => l.includes("code=promptfile-error"))).toBe(true)
  })

  it("malformed JSON: fail-loud injects error block, no rules applied", async () => {
    writeFileSync(configPath, "{ not valid json")
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system[0]).toContain("<SYSTEM POLICY ERROR")
    expect(output.system[0]).toContain("config-malformed")
    // original is preserved at position 1
    expect(output.system).toContain("original")
    // and the config-malformed error reached stderr as a structured line
    expect(stderrLines().some((l) => l.includes("code=config-malformed"))).toBe(true)
  })

  it("default does not fire when an explicit rule matched but failed to resolve promptFile", async () => {
    writeFileSync(configPath, JSON.stringify({
      lenient: true,  // suppress visible error block so we can assert cleanly on output.system
      default: { mode: "append", prompt: "DEFAULT-SHOULD-NOT-APPEAR" },
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", promptFile: "./missing.md" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system).not.toContain("DEFAULT-SHOULD-NOT-APPEAR")
    expect(output.system).toEqual(["original"])
  })

  it("no config file: silent no-op", async () => {
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system).toEqual(["original"])
  })
})
