import type { ParsedRule } from "./types"
import { DEFAULT_DYNAMIC_BOUNDARY, DEFAULT_FALLBACK_DYNAMIC_BOUNDARY } from "./constants"

export function findDynamicBoundary(
  fullPrompt: string,
  marker: string = DEFAULT_DYNAMIC_BOUNDARY,
  fallbackMarker: string = DEFAULT_FALLBACK_DYNAMIC_BOUNDARY,
): number {
  const idx = fullPrompt.indexOf(marker)
  if (idx !== -1) return idx
  const fallbackIdx = fullPrompt.indexOf(fallbackMarker)
  if (fallbackIdx !== -1) {
    const nlIdx = fullPrompt.lastIndexOf('\n', fallbackIdx - 1)
    return nlIdx !== -1 ? nlIdx : fallbackIdx
  }
  return -1
}

export function applyRule(
  rule: ParsedRule,
  text: string,
  output: { system: string[] },
  dynamicBoundaryMarker?: string,
  dynamicFallbackMarker?: string,
): void {
  if (rule.mode === "replace") {
    if (rule.preserveDynamic) {
      const fullPrompt = output.system[0] || ''
      const boundary = findDynamicBoundary(
        fullPrompt,
        dynamicBoundaryMarker,
        dynamicFallbackMarker,
      )
      if (boundary !== -1) {
        output.system[0] = text + fullPrompt.slice(boundary)
        return
      }
    }
    output.system.splice(0, output.system.length, text)
    return
  }
  if (rule.position === "start") {
    output.system.unshift(text)
    return
  }
  output.system.push(text)
}
