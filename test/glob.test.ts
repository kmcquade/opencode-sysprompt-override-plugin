import { describe, it, expect } from "bun:test"
import { globToRegex } from "../src/glob"

describe("globToRegex", () => {
  it("matches `*` to any sequence of characters", () => {
    const r = globToRegex("qwen*")
    expect(r.test("qwen3-coder")).toBe(true)
    expect(r.test("qwen-plus")).toBe(true)
    expect(r.test("qwen")).toBe(true)
    expect(r.test("claude-qwen")).toBe(false)
  })

  it("matches `?` to exactly one character", () => {
    const r = globToRegex("qwen?")
    expect(r.test("qwen3")).toBe(true)
    expect(r.test("qwen")).toBe(false)
    expect(r.test("qwen33")).toBe(false)
  })

  it("escapes regex metacharacters in literal portions", () => {
    const r = globToRegex("claude-3.5")
    expect(r.test("claude-3.5")).toBe(true)
    expect(r.test("claude-3X5")).toBe(false)
  })

  it("anchors at both ends", () => {
    const r = globToRegex("foo")
    expect(r.test("foo")).toBe(true)
    expect(r.test("foobar")).toBe(false)
    expect(r.test("barfoo")).toBe(false)
  })

  it("handles empty pattern as exact-match-empty", () => {
    const r = globToRegex("")
    expect(r.test("")).toBe(true)
    expect(r.test("x")).toBe(false)
  })

  it("combines `*` and `?`", () => {
    const r = globToRegex("a?c*")
    expect(r.test("abc")).toBe(true)
    expect(r.test("abcde")).toBe(true)
    expect(r.test("ac")).toBe(false)
  })
})
