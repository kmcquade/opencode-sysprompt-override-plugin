/**
 * Smoke 1: bundle integration test.
 *
 * Imports dist/index.js (the built bundle) and exercises the same key scenarios
 * as test/integration.test.ts to catch bundle-level issues such as broken
 * imports, missing transformations, or dead-code elimination removing used code.
 *
 * Run via:  make smoke-bundle  (not included in `make test`)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

let bundledPlugin: (ctx: any) => Promise<any>

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

let tmp: string
let opencodeDir: string
let configPath: string

beforeAll(async () => {
  // Always rebuild to ensure the bundle is fresh.
  const result = spawnSync(
    "bun",
    ["build", "src/index.ts", "--target=bun", "--outdir=dist", "--format=esm"],
    {
      cwd: join(import.meta.dir, ".."),
      stdio: "pipe",
    },
  )
  if (result.status !== 0) {
    throw new Error(`Bundle build failed:\n${result.stderr?.toString()}`)
  }

  // Dynamic import of the built bundle.
  const mod = await import("../dist/index.js")
  bundledPlugin = mod.default
})

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "bundle-smoke-"))
  opencodeDir = join(tmp, ".opencode")
  mkdirSync(opencodeDir, { recursive: true })
  configPath = join(opencodeDir, "system-prompts.json")
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe("bundled plugin smoke", () => {
  it("happy path: qwen replace rule applies", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        default: { mode: "append", prompt: "DEFAULT" },
        rules: [{ match: { modelIDGlob: "qwen*" }, mode: "replace", prompt: "QWEN-BUNDLE-OVERRIDE" }],
      }),
    )
    const hooks = await bundledPlugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]({ model: qwen }, output)
    expect(output.system).toEqual(["QWEN-BUNDLE-OVERRIDE"])
  })

  it("fail-loud: missing promptFile injects error block and writes log", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        rules: [
          { match: { modelIDGlob: "qwen*" }, mode: "replace", promptFile: "./missing.md" },
          { match: {}, mode: "append", prompt: "VALID" },
        ],
      }),
    )
    const hooks = await bundledPlugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]({ model: qwen }, output)
    expect(output.system[0]).toContain("<SYSTEM POLICY ERROR")
    expect(output.system).toContain("VALID")

    const logPath = join(opencodeDir, "system-prompt-override.log")
    expect(existsSync(logPath)).toBe(true)
    const entry = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n")[0]!)
    expect(entry.code).toBe("promptfile-error")
    expect(entry.ruleIndex).toBe(0)
  })

  it("default fires when no explicit rule matched", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        default: { mode: "append", prompt: "DEFAULT-BUNDLE" },
        rules: [{ match: { modelIDGlob: "qwen*" }, mode: "replace", prompt: "QWEN" }],
      }),
    )
    const hooks = await bundledPlugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]({ model: claude }, output)
    expect(output.system).toEqual(["original", "DEFAULT-BUNDLE"])
  })

  it("no config file: silent no-op", async () => {
    // Don't write configPath — should be a no-op
    const hooks = await bundledPlugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]({ model: qwen }, output)
    expect(output.system).toEqual(["original"])
  })
})
