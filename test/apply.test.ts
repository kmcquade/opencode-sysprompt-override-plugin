import { describe, it, expect } from "bun:test"
import { applyRule, findDynamicBoundary } from "../src/apply"
import { DEFAULT_DYNAMIC_BOUNDARY, DEFAULT_FALLBACK_DYNAMIC_BOUNDARY } from "../src/constants"
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

  it("replace with preserveDynamic keeps dynamic section when boundary found", () => {
    const dynamicTail = `${DEFAULT_DYNAMIC_BOUNDARY} llama-9000`
    const out = { system: ["some static prompt" + dynamicTail, "extra"] }
    applyRule(
      rule({ mode: "replace", position: "end", preserveDynamic: true }),
      "REPLACED",
      out,
    )
    expect(out.system).toEqual(["REPLACED" + dynamicTail])

  it("replace with preserveDynamic falls back to full splice when no boundary found", () => {
    const out = { system: ["no boundary marker here", "extra"] }
    applyRule(
      rule({ mode: "replace", position: "end", preserveDynamic: true }),
      "REPLACED",
      out,
    )
    expect(out.system).toEqual(["REPLACED"])
  })

  it("replace with preserveDynamic uses fallback marker when primary absent", () => {
    const dynamicTail = `${DEFAULT_FALLBACK_DYNAMIC_BOUNDARY}\n  <env>production</env>`
    const out = { system: ["static" + dynamicTail] }
    applyRule(
      rule({ mode: "replace", position: "end", preserveDynamic: true }),
      "REPLACED",
      out,
    )
    expect(out.system[0]).toBe("REPLACED" + dynamicTail)
  })

  it("replace without preserveDynamic (default) always does full splice", () => {
    const dynamicTail = `${DEFAULT_DYNAMIC_BOUNDARY} llama-9000`
    const out = { system: ["static" + dynamicTail] }
    applyRule(
      rule({ mode: "replace", position: "end", preserveDynamic: false }),
      "REPLACED",
      out,
    )
    expect(out.system).toEqual(["REPLACED"])
  })

  it("preserveDynamic with custom boundary markers uses those over defaults", () => {
    const out = { system: ["static", "CUSTOM_MARKER dynamic stuff"] }
    applyRule(
      rule({ mode: "replace", position: "end", preserveDynamic: true }),
      "REPLACED",
      out,
      "CUSTOM_MARKER",
      "FALLBACK",
    )
    expect(out.system[0]).toBe("REPLACED")
  })

  it("preserveDynamic with custom markers matches when present", () => {
    const out = { system: ["static" + "CUSTOM_MARKER dynamic"] }
    applyRule(
      rule({ mode: "replace", position: "end", preserveDynamic: true }),
      "REPLACED",
      out,
      "CUSTOM_MARKER",
      "FALLBACK",
    )
    expect(out.system[0]).toBe("REPLACED" + "CUSTOM_MARKER dynamic")
  })

  it("preserveDynamic with empty system array falls back to full splice", () => {
    const out = { system: [] as string[] }
    applyRule(
      rule({ mode: "replace", position: "end", preserveDynamic: true }),
      "REPLACED",
      out,
    )
    expect(out.system).toEqual(["REPLACED"])
  })

  it("preserveDynamic is ignored when mode is append (end)", () => {
    const dynamicTail = `${DEFAULT_DYNAMIC_BOUNDARY} llama-9000`
    const out = { system: ["base" + dynamicTail] }
    applyRule(
      rule({ mode: "append", position: "end", preserveDynamic: true }),
      "added",
      out,
    )
    expect(out.system).toEqual(["base" + dynamicTail, "added"])
  })

  it("preserveDynamic is ignored when mode is append (start)", () => {
    const dynamicTail = `${DEFAULT_DYNAMIC_BOUNDARY} llama-9000`
    const out = { system: ["base" + dynamicTail] }
    applyRule(
      rule({ mode: "append", position: "start", preserveDynamic: true }),
      "added",
      out,
    )
    expect(out.system).toEqual(["added", "base" + dynamicTail])
  })

  it("preserveDynamic with boundary at position 0 keeps everything", () => {
    const prompt = `${DEFAULT_DYNAMIC_BOUNDARY} claude\n<env>production</env>`
    const out = { system: [prompt] }
    applyRule(
      rule({ mode: "replace", position: "end", preserveDynamic: true }),
      "REPLACED",
      out,
    )
    expect(out.system[0]).toBe("REPLACED" + prompt)
  })
})

describe("findDynamicBoundary", () => {
  it("returns index of default boundary marker when present", () => {
    const prompt = "some prompt\nYou are powered by the model named claude"
    const idx = findDynamicBoundary(prompt)
    expect(idx).toBe(prompt.indexOf(DEFAULT_DYNAMIC_BOUNDARY))
  })

  it("returns -1 when neither marker is present", () => {
    const prompt = "just a plain prompt without any boundary"
    const idx = findDynamicBoundary(prompt)
    expect(idx).toBe(-1)
  })

  it("uses fallback marker when primary is absent", () => {
    const prompt = "some prompt\n<env>\n  <env>production</env>"
    const idx = findDynamicBoundary(prompt)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(prompt.slice(idx)).toContain("<env>")
  })

  it("returns -1 when custom markers also absent", () => {
    const prompt = "plain old prompt"
    const idx = findDynamicBoundary(prompt, "CUSTOM_A", "CUSTOM_B")
    expect(idx).toBe(-1)
  })

  it("returns index for custom marker when present", () => {
    const prompt = "static\nCUSTOM_BOUNDARY rest"
    const idx = findDynamicBoundary(prompt, "CUSTOM_BOUNDARY", "OTHER")
    expect(idx).toBe(prompt.indexOf("CUSTOM_BOUNDARY"))
  })

  it("falls back from custom primary to custom fallback", () => {
    const prompt = "static\nCUSTOM_FALLBACK rest"
    const idx = findDynamicBoundary(prompt, "PRIMARY", "CUSTOM_FALLBACK")
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(prompt.slice(idx)).toContain("CUSTOM_FALLBACK")
  })

  it("fallback boundary snaps to preceding newline", () => {
    // prompt: "first line\nsecond line\n<env>\n  something"
    // fallbackMarker "\n<env>" starts at index 22 (the "\n" before "<env>")
    // lastIndexOf('\n', 21) finds the newline at index 10 (between "first line" and "second line")
    const prompt = "first line\nsecond line\n<env>\n  something"
    const idx = findDynamicBoundary(prompt, "MISSING", "\n<env>")
    expect(idx).toBe(10)
  })
})
