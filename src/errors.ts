import type { ErrorEvent } from "./types"
import { writeLog } from "./log"

export interface ErrorContext {
  logPath: string
  lenient: boolean
  configPath?: string
  output: { system: string[] }
  seen: Set<string>
}

export function reportError(
  ctx: ErrorContext,
  code: string,
  message: string,
  opts: { ruleIndex?: number; path?: string } = {},
): void {
  const path = opts.path ?? ctx.configPath
  const dedupeKey = `${code}|${path ?? ""}|${opts.ruleIndex ?? ""}`
  const firstTime = !ctx.seen.has(dedupeKey)

  if (firstTime) {
    ctx.seen.add(dedupeKey)
    const event: ErrorEvent = {
      timestamp: new Date().toISOString(),
      ...(path !== undefined ? { path } : {}),
      ...(opts.ruleIndex !== undefined ? { ruleIndex: opts.ruleIndex } : {}),
      code,
      message,
    }
    writeLog(ctx.logPath, event)
    if (ctx.lenient) {
      console.warn(`[opencode-sysprompt-override] ${code}: ${message}`)
    }
  }

  if (!ctx.lenient) {
    const block =
      `<SYSTEM POLICY ERROR: ${code}: ${message}>\n` +
      `The opencode-sysprompt-override plugin failed to apply this rule. ` +
      `See ${ctx.logPath} for details.`
    ctx.output.system.unshift(block)
  }
}
