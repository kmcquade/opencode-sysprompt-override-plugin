import { existsSync, statSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { homedir } from "node:os"
import type { Config, ParsedRule, Rule } from "./types"
import { compileMatch } from "./match"
import { DEFAULT_DYNAMIC_BOUNDARY, DEFAULT_FALLBACK_DYNAMIC_BOUNDARY } from "./constants"

export interface LoadedConfig {
  path: string
  dir: string
  logPath: string
  mtimeMs: number
  cfg: Config
  parsedRules: ParsedRule[]
  parsedDefault: ParsedRule | null
  errors: Array<{ code: string; message: string; ruleIndex?: number }>
  seen: Set<string>
  dynamicBoundaryMarker: string
  dynamicFallbackMarker: string
}

let cached: LoadedConfig | null = null

export function loadConfigIfChanged(projectDir: string): LoadedConfig | null {
  const found = configCandidates(projectDir).find((p) => existsSync(p))
  if (!found) {
    cached = null
    return null
  }

  const st = statSync(found)
  if (cached && cached.path === found && cached.mtimeMs === st.mtimeMs) return cached

  const dir = dirname(found)
  const logPath = join(dir, "system-prompt-override.log")
  const seen = new Set<string>()
  const errors: LoadedConfig["errors"] = []

  let raw: string
  try {
    raw = readFileSync(found, "utf8")
  } catch (err) {
    const failed: LoadedConfig = {
      path: found, dir, logPath, mtimeMs: st.mtimeMs,
      cfg: {}, parsedRules: [], parsedDefault: null,
      errors: [{ code: "config-unreadable", message: String(err) }],
      seen,
      dynamicBoundaryMarker: DEFAULT_DYNAMIC_BOUNDARY,
      dynamicFallbackMarker: DEFAULT_FALLBACK_DYNAMIC_BOUNDARY,
    }
    cached = failed
    return failed
  }

  let cfg: Config
  try {
    cfg = JSON.parse(raw) as Config
  } catch (err) {
    const failed: LoadedConfig = {
      path: found, dir, logPath, mtimeMs: st.mtimeMs,
      cfg: {}, parsedRules: [], parsedDefault: null,
      errors: [{ code: "config-malformed", message: String(err) }],
      seen,
      dynamicBoundaryMarker: DEFAULT_DYNAMIC_BOUNDARY,
      dynamicFallbackMarker: DEFAULT_FALLBACK_DYNAMIC_BOUNDARY,
    }
    cached = failed
    return failed
  }

  const parsedRules: ParsedRule[] = []
  for (let i = 0; i < (cfg.rules ?? []).length; i++) {
    const r = cfg.rules![i]!
    try {
      parsedRules.push(parseRule(r, i))
    } catch (err) {
      errors.push({ code: "rule-invalid", message: String(err), ruleIndex: i })
    }
  }

  let parsedDefault: ParsedRule | null = null
  if (cfg.default) {
    try {
      parsedDefault = parseRule({ ...cfg.default }, -1)
    } catch (err) {
      errors.push({ code: "default-invalid", message: String(err) })
    }
  }

  const loaded: LoadedConfig = {
    path: found, dir, logPath, mtimeMs: st.mtimeMs,
    cfg, parsedRules, parsedDefault, errors, seen,
    dynamicBoundaryMarker: typeof cfg.dynamicBoundaryMarker === "string" ? cfg.dynamicBoundaryMarker : DEFAULT_DYNAMIC_BOUNDARY,
    dynamicFallbackMarker: typeof cfg.dynamicFallbackMarker === "string" ? cfg.dynamicFallbackMarker : DEFAULT_FALLBACK_DYNAMIC_BOUNDARY,
  }
  cached = loaded
  return loaded
}

function parseRule(rule: Rule, index: number): ParsedRule {
  if (rule.mode !== "append" && rule.mode !== "replace") {
    throw new Error(`unknown mode: ${String((rule as { mode: unknown }).mode)}`)
  }
  if (rule.match !== undefined && (typeof rule.match !== "object" || rule.match === null || Array.isArray(rule.match))) {
    throw new Error(`match must be an object`)
  }
  if (rule.position !== undefined && rule.position !== "start" && rule.position !== "end") {
    throw new Error(`unknown position: ${String((rule as { position: unknown }).position)}`)
  }
  const hasPrompt = typeof rule.prompt === "string"
  const hasFile = typeof rule.promptFile === "string"
  if (hasPrompt === hasFile) {
    throw new Error("rule must have exactly one of prompt or promptFile")
  }
  const parsed: ParsedRule = {
    raw: rule,
    index,
    match: compileMatch(rule.match),
    mode: rule.mode,
    position: rule.position ?? "end",
    preserveDynamic: rule.preserveDynamic === true,
  }
  if (rule.prompt !== undefined) parsed.prompt = rule.prompt
  if (rule.promptFile !== undefined) parsed.promptFile = rule.promptFile
  return parsed
}

export function resolvePromptText(rule: ParsedRule, configDir: string): string {
  if (rule.prompt !== undefined) return rule.prompt
  if (rule.promptFile === undefined) {
    throw new Error("rule has no prompt source")
  }
  const filePath = isAbsolute(rule.promptFile)
    ? rule.promptFile
    : resolve(configDir, rule.promptFile)
  return readFileSync(filePath, "utf8")
}

export function clearCache(): void {
  cached = null
}

function configCandidates(projectDir: string): string[] {
  const env = process.env.OPENCODE_SYSTEM_PROMPT_CONFIG
  return [
    env,
    join(projectDir, ".opencode", "system-prompts.json"),
    join(homedir(), ".config", "opencode", "system-prompts.json"),
    join(homedir(), ".opencode", "system-prompts.json"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0)
}
