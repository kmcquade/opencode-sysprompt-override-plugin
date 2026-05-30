import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "node:fs"
import { join } from "node:path"
import * as os from "node:os"
import { tmpdir } from "node:os"
import { loadConfigIfChanged, resolvePromptText, clearCache } from "../src/config"

let tmp: string
let opencodeDir: string
let configPath: string
// An empty sandbox standing in for the user's home dir, so the global config
// candidates (~/.config/opencode, ~/.opencode) can't leak a real config on a
// developer's machine. The fallback chain still runs — it just finds nothing.
let fakeHome: string
let homedirSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "config-test-"))
  fakeHome = mkdtempSync(join(tmpdir(), "config-test-home-"))
  homedirSpy = spyOn(os, "homedir").mockReturnValue(fakeHome)
  opencodeDir = join(tmp, ".opencode")
  mkdirSync(opencodeDir, { recursive: true })
  configPath = join(opencodeDir, "system-prompts.json")
  clearCache()
  delete process.env.OPENCODE_SYSTEM_PROMPT_CONFIG
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
  homedirSpy.mockRestore()
  clearCache()
  delete process.env.OPENCODE_SYSTEM_PROMPT_CONFIG
})

describe("loadConfigIfChanged", () => {
  it("returns null when no config file exists", () => {
    expect(loadConfigIfChanged(tmp)).toBeNull()
  })

  it("loads a valid config", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ match: { modelID: "qwen3-coder" }, mode: "replace", prompt: "p" }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded).not.toBeNull()
    expect(loaded!.parsedRules.length).toBe(1)
    expect(loaded!.parsedRules[0]!.mode).toBe("replace")
    expect(loaded!.errors.length).toBe(0)
  })

  it("returns the cached config when mtime is unchanged", () => {
    writeFileSync(configPath, JSON.stringify({ rules: [] }))
    const first = loadConfigIfChanged(tmp)
    const second = loadConfigIfChanged(tmp)
    expect(second).toBe(first) // same reference
  })

  it("re-reads when mtime changes", () => {
    writeFileSync(configPath, JSON.stringify({ rules: [] }))
    const first = loadConfigIfChanged(tmp)
    // Write new content then bump mtime forward so it's guaranteed to differ
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", prompt: "x" }],
    }))
    const future = new Date(Date.now() + 5000)
    utimesSync(configPath, future, future)
    const second = loadConfigIfChanged(tmp)
    expect(second).not.toBe(first)
    expect(second!.parsedRules.length).toBe(1)
  })

  it("captures malformed JSON as a config-malformed error", () => {
    writeFileSync(configPath, "{ not valid json")
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded).not.toBeNull()
    expect(loaded!.errors[0]!.code).toBe("config-malformed")
    expect(loaded!.parsedRules.length).toBe(0)
  })

  it("captures rule-invalid for rule with both prompt and promptFile", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", prompt: "x", promptFile: "y" }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.errors.length).toBe(1)
    expect(loaded!.errors[0]!.code).toBe("rule-invalid")
    expect(loaded!.errors[0]!.ruleIndex).toBe(0)
  })

  it("captures rule-invalid for unknown mode", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "blast", prompt: "x" }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.errors[0]!.code).toBe("rule-invalid")
  })

  it("captures rule-invalid for scalar match (e.g. \"match\": \"qwen*\")", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ match: "qwen*", mode: "append", prompt: "x" }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.errors[0]!.code).toBe("rule-invalid")
    expect(loaded!.errors[0]!.message).toContain("match")
  })

  it("captures rule-invalid for array match", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ match: ["qwen"], mode: "append", prompt: "x" }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.errors[0]!.code).toBe("rule-invalid")
  })

  it("captures rule-invalid for unknown position", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", position: "middle", prompt: "x" }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.errors[0]!.code).toBe("rule-invalid")
    expect(loaded!.errors[0]!.message).toContain("position")
  })

  it("parses default rule when present", () => {
    writeFileSync(configPath, JSON.stringify({
      default: { mode: "append", prompt: "fallback" },
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.parsedDefault).not.toBeNull()
    expect(loaded!.parsedDefault!.prompt).toBe("fallback")
  })

  it("parses inline prompts containing // and https:// safely", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{
        mode: "replace",
        prompt: "Visit https://example.com or use // for comments in code. /* like this */",
      }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.errors.length).toBe(0)
    expect(loaded!.parsedRules[0]!.prompt).toContain("https://example.com")
  })

  it("respects OPENCODE_SYSTEM_PROMPT_CONFIG env var", () => {
    const altPath = join(tmp, "alt-config.json")
    writeFileSync(altPath, JSON.stringify({ rules: [{ mode: "append", prompt: "alt" }] }))
    process.env.OPENCODE_SYSTEM_PROMPT_CONFIG = altPath
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.path).toBe(altPath)
    expect(loaded!.parsedRules[0]!.prompt).toBe("alt")
  })

  it("computes logPath relative to the config directory", () => {
    writeFileSync(configPath, JSON.stringify({ rules: [] }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.logPath).toBe(join(opencodeDir, "system-prompt-override.log"))
  })
})

describe("resolvePromptText", () => {
  it("returns inline prompt", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", prompt: "hello" }],
    }))
    const loaded = loadConfigIfChanged(tmp)!
    expect(resolvePromptText(loaded.parsedRules[0]!, loaded.dir)).toBe("hello")
  })

  it("reads promptFile relative to config dir", () => {
    const promptPath = join(opencodeDir, "p.md")
    writeFileSync(promptPath, "from file")
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", promptFile: "./p.md" }],
    }))
    const loaded = loadConfigIfChanged(tmp)!
    expect(resolvePromptText(loaded.parsedRules[0]!, loaded.dir)).toBe("from file")
  })

  it("throws when promptFile is missing", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", promptFile: "./nope.md" }],
    }))
    const loaded = loadConfigIfChanged(tmp)!
    expect(() => resolvePromptText(loaded.parsedRules[0]!, loaded.dir)).toThrow()
  })
})
