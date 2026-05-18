import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { clearCache } from "../src/config"
import plugin from "../src/index"

let tmp: string
let opencodeDir: string
let configPath: string
let logPath: string

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
  opencodeDir = join(tmp, ".opencode")
  mkdirSync(opencodeDir, { recursive: true })
  configPath = join(opencodeDir, "system-prompts.json")
  logPath = join(opencodeDir, "system-prompt-override.log")
  clearCache()
  delete process.env.OPENCODE_SYSTEM_PROMPT_CONFIG
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  clearCache()
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
