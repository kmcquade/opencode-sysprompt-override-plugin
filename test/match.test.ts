import { describe, it, expect } from "bun:test"
import { compileMatch, matches } from "../src/match"
import type { ParsedRule, ModelLike } from "../src/types"

function makeRule(matchSpec: Parameters<typeof compileMatch>[0]): ParsedRule {
  return {
    raw: { mode: "append" },
    index: 0,
    match: compileMatch(matchSpec),
    mode: "append",
    position: "end",
  }
}

const qwen: ModelLike = { providerID: "openrouter", id: "qwen3-coder" }
const claude: ModelLike = { providerID: "anthropic", id: "claude-sonnet-4-6" }

describe("matches", () => {
  it("empty match matches every model", () => {
    expect(matches(makeRule(undefined), qwen)).toBe(true)
    expect(matches(makeRule({}), claude)).toBe(true)
  })

  it("exact providerID matches", () => {
    const r = makeRule({ providerID: "anthropic" })
    expect(matches(r, claude)).toBe(true)
    expect(matches(r, qwen)).toBe(false)
  })

  it("exact modelID matches model.id (not modelID)", () => {
    const r = makeRule({ modelID: "qwen3-coder" })
    expect(matches(r, qwen)).toBe(true)
    expect(matches(r, claude)).toBe(false)
  })

  it("providerIDGlob matches via glob", () => {
    const r = makeRule({ providerIDGlob: "open*" })
    expect(matches(r, qwen)).toBe(true)
    expect(matches(r, claude)).toBe(false)
  })

  it("modelIDGlob matches via glob", () => {
    const r = makeRule({ modelIDGlob: "qwen*" })
    expect(matches(r, qwen)).toBe(true)
    expect(matches(r, claude)).toBe(false)
  })

  it("multiple fields AND together", () => {
    const r = makeRule({ providerID: "openrouter", modelIDGlob: "qwen*" })
    expect(matches(r, qwen)).toBe(true)
    expect(matches(r, { providerID: "openrouter", id: "claude-3" })).toBe(false)
    expect(matches(r, { providerID: "other", id: "qwen3-coder" })).toBe(false)
  })

  it("exact and glob on the same field both must match if both set", () => {
    const r = makeRule({ providerID: "openrouter", providerIDGlob: "open*" })
    expect(matches(r, qwen)).toBe(true)
    const r2 = makeRule({ providerID: "openrouter", providerIDGlob: "anthropic*" })
    expect(matches(r2, qwen)).toBe(false)
  })
})
