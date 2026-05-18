import type { ModelLike, ParsedRule, MatchSpec, CompiledMatch } from "./types"
import { globToRegex } from "./glob"

export function compileMatch(spec: MatchSpec | undefined): CompiledMatch {
  if (!spec) return {}
  const out: CompiledMatch = {}
  if (spec.providerID !== undefined) out.providerID = spec.providerID
  if (spec.modelID !== undefined) out.modelID = spec.modelID
  if (spec.providerIDGlob !== undefined) out.providerIDRegex = globToRegex(spec.providerIDGlob)
  if (spec.modelIDGlob !== undefined) out.modelIDRegex = globToRegex(spec.modelIDGlob)
  return out
}

export function matches(rule: ParsedRule, model: ModelLike): boolean {
  const m = rule.match
  if (m.providerID !== undefined && m.providerID !== model.providerID) return false
  if (m.providerIDRegex !== undefined && !m.providerIDRegex.test(model.providerID)) return false
  if (m.modelID !== undefined && m.modelID !== model.id) return false
  if (m.modelIDRegex !== undefined && !m.modelIDRegex.test(model.id)) return false
  return true
}
