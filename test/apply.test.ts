import { describe, it, expect } from "bun:test"
import { applyRule } from "../src/apply"
import type { ParsedRule } from "../src/types"

function rule(opts: Partial<ParsedRule> & Pick<ParsedRule, "mode" | "position">): ParsedRule {
  return {
    raw: { mode: opts.mode },
    index: 0,
    match: {},
    prompt: "x",
    ...opts,
  } as ParsedRule
}

describe("applyRule", () => {
  it("append/end pushes to the end", () => {
    const out = { system: ["base"] }
    applyRule(rule({ mode: "append", position: "end" }), "added", out)
    expect(out.system).toEqual(["base", "added"])
  })

  it("append/start unshifts to the start", () => {
    const out = { system: ["base"] }
    applyRule(rule({ mode: "append", position: "start" }), "added", out)
    expect(out.system).toEqual(["added", "base"])
  })

  it("replace clears the array and inserts", () => {
    const out = { system: ["a", "b", "c"] }
    applyRule(rule({ mode: "replace", position: "end" }), "fresh", out)
    expect(out.system).toEqual(["fresh"])
  })

  it("multiple rules stack in order", () => {
    const out = { system: ["base"] }
    applyRule(rule({ mode: "append", position: "end" }), "1", out)
    applyRule(rule({ mode: "append", position: "end" }), "2", out)
    expect(out.system).toEqual(["base", "1", "2"])
  })

  it("replace after append wipes the appended content", () => {
    const out = { system: ["base"] }
    applyRule(rule({ mode: "append", position: "end" }), "added", out)
    applyRule(rule({ mode: "replace", position: "end" }), "fresh", out)
    expect(out.system).toEqual(["fresh"])
  })

  it("append after replace preserves the replacement plus the append", () => {
    const out = { system: ["base"] }
    applyRule(rule({ mode: "replace", position: "end" }), "fresh", out)
    applyRule(rule({ mode: "append", position: "end" }), "extra", out)
    expect(out.system).toEqual(["fresh", "extra"])
  })
})
