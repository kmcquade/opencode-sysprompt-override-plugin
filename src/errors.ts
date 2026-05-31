import type { ErrorEvent } from "./types"
import { writeLog } from "./log"

// Collapse a message to a single line and escape backslashes + quotes so the
// worker's line-buffered stderr scanner can parse one record per newline
// cleanly. Backslashes MUST be escaped before quotes: otherwise the `\` we add
// when escaping a `"` would itself be doubled, and — more importantly — a
// message ending in a lone backslash would turn the closing `"` of the msg
// field into an escaped quote, letting crafted error text break out of
// `msg="…"` and inject spurious key=value tokens (CWE-116 incomplete escaping).
function formatStderrLine(
  code: string,
  message: string,
  path: string | undefined,
  ruleIndex: number | undefined,
): string {
  const safeMessage = message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
  return (
    `[opencode-sysprompt-override] error code=${code} ` +
    `ruleIndex=${ruleIndex ?? "-"} ` +
    `path=${path ?? "-"} ` +
    `msg="${safeMessage}"`
  )
}

export interface ErrorContext {
  logPath: string
  lenient: boolean
  configPath?: string
  output: { system: string[] }
  seen: Set<string>
  pendingBlocks: string[]
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
    // Always surface the error to stderr, independent of lenient mode, so the
    // OpenCode subprocess's stderr (the worker's only error egress) carries it.
    // Lenient mode governs only the SYSTEM POLICY ERROR block injection below.
    console.error(formatStderrLine(code, message, path, opts.ruleIndex))
  }

  if (!ctx.lenient) {
    const block =
      `<SYSTEM POLICY ERROR: ${code}: ${message}>\n` +
      `The opencode-sysprompt-override plugin failed to apply this rule. ` +
      `See ${ctx.logPath} for details.`
    ctx.pendingBlocks.push(block)
  }
}

export function flushErrors(ctx: ErrorContext): void {
  if (ctx.pendingBlocks.length === 0) return
  ctx.output.system.unshift(...ctx.pendingBlocks)
  ctx.pendingBlocks.length = 0
}
