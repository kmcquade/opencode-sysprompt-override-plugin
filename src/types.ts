export type Mode = "append" | "replace"
export type Position = "start" | "end"

export interface MatchSpec {
  providerID?: string
  providerIDGlob?: string
  modelID?: string
  modelIDGlob?: string
}

export interface Rule {
  match?: MatchSpec
  mode: Mode
  position?: Position
  prompt?: string
  promptFile?: string
}

export interface Config {
  lenient?: boolean
  default?: Omit<Rule, "match">
  rules?: Rule[]
}

export interface ModelLike {
  providerID: string
  id: string
}

export interface ErrorEvent {
  timestamp: string
  path?: string
  ruleIndex?: number
  code: string
  message: string
}

export interface CompiledMatch {
  providerID?: string
  modelID?: string
  providerIDRegex?: RegExp
  modelIDRegex?: RegExp
}

export interface ParsedRule {
  raw: Rule
  index: number          // -1 for the synthetic default rule
  match: CompiledMatch   // empty object {} = match-all
  mode: Mode
  position: Position
  prompt?: string
  promptFile?: string
}
