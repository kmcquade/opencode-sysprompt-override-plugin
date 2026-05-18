import type { Plugin } from "@opencode-ai/plugin"
import { loadConfigIfChanged, resolvePromptText } from "./config"
import { matches } from "./match"
import { applyRule } from "./apply"
import { reportError, type ErrorContext } from "./errors"
import type { ModelLike, ParsedRule } from "./types"

const plugin: Plugin = async (ctx) => {
  return {
    "experimental.chat.system.transform": async (input, output) => {
      try {
        // input.model has shape { id, providerID, api, ... } per @opencode-ai/sdk Model.
        // We only need the two narrow fields.
        const model: ModelLike = {
          providerID: (input.model as { providerID: string }).providerID,
          id: (input.model as { id: string }).id,
        }
        transform(ctx.directory, model, output)
      } catch (err) {
        // Last-resort guard. Should never trigger because each step has its own try/catch.
        console.error("[opencode-sysprompt-override] handler crashed:", err)
      }
    },
  }
}

function transform(
  projectDir: string,
  model: ModelLike,
  output: { system: string[] },
): void {
  const loaded = loadConfigIfChanged(projectDir)
  if (!loaded) return

  const errCtx: ErrorContext = {
    logPath: loaded.logPath,
    lenient: loaded.cfg.lenient === true,
    configPath: loaded.path,
    output,
    seen: loaded.seen,
  }

  for (const e of loaded.errors) {
    reportError(errCtx, e.code, e.message, e.ruleIndex !== undefined ? { ruleIndex: e.ruleIndex } : {})
  }

  const matched: ParsedRule[] = loaded.parsedRules.filter((r) => matches(r, model))

  let anyApplied = false
  for (const rule of matched) {
    let text: string
    try {
      text = resolvePromptText(rule, loaded.dir)
    } catch (err) {
      reportError(errCtx, "promptfile-error", String(err), { ruleIndex: rule.index })
      continue
    }
    applyRule(rule, text, output)
    anyApplied = true
  }

  if (!anyApplied && loaded.parsedDefault) {
    let text: string
    try {
      text = resolvePromptText(loaded.parsedDefault, loaded.dir)
    } catch (err) {
      reportError(errCtx, "default-promptfile-error", String(err))
      return
    }
    applyRule(loaded.parsedDefault, text, output)
  }
}

export default plugin
