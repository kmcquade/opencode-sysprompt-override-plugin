import type { ParsedRule } from "./types"

export function applyRule(
  rule: ParsedRule,
  text: string,
  output: { system: string[] },
): void {
  if (rule.mode === "replace") {
    output.system.splice(0, output.system.length, text)
    return
  }
  if (rule.position === "start") {
    output.system.unshift(text)
    return
  }
  output.system.push(text)
}
