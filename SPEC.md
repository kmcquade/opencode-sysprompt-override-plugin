# opencode System-Prompt Override Plugin — Build Spec

## Goal

Build an opencode plugin that lets a user supply custom system prompts per model via a config file. The plugin must support two modes per entry: **append** (add to the existing system prompt) and **replace** (wipe the default and use ours). Different entries can target different `providerID` / model-id pairs, including custom/user-defined models.

Hand this spec to a fresh Claude Code session along with a checkout of `repos/opencode` (or just the plugin SDK package) and it should be able to build, test, and ship the plugin without further questions.

---

## Background: facts verified against the opencode source

All claims below were checked against `repos/opencode` on the `dev` branch (HEAD: `e85119aa6`, May 2026). File paths and line numbers refer to that checkout. **Do not re-derive these — they were wrong in earlier drafts.**

### 1. The hook exists, and the input shape uses `model.id` (NOT `model.modelID`)

Defined in `packages/plugin/src/index.ts:290-295`:

```ts
"experimental.chat.system.transform"?: (
  input: { sessionID?: string; model: Model },
  output: { system: string[] },
) => Promise<void>
```

`Model` is imported from `@opencode-ai/sdk` and is defined at `packages/sdk/js/src/gen/types.gen.ts:1456`:

```ts
export type Model = {
  id: string
  providerID: string
  api: { id: string; url: string; npm: string }
  name: string
  capabilities: { ... }
  // ...
}
```

**The field is `model.id`, not `model.modelID`.** An old draft of this spec said `modelID` — that was wrong. The unit tests at `packages/opencode/test/plugin/trigger.test.ts:80-85` happen to pass a `{ providerID, modelID }` literal, but that test only exercises the trigger plumbing and never reads the field — it does not reflect the production payload.

In production (`packages/opencode/src/session/llm.ts:118-122`), the hook receives the real `Provider.Model` with `.id`:

```ts
yield* plugin.trigger(
  "experimental.chat.system.transform",
  { sessionID: input.sessionID, model: input.model },
  { system },
)
```

`Provider.Model` is defined at `packages/opencode/src/provider/provider.ts:910-925` and also uses `id`, not `modelID`.

### 2. `output.system` is mutable

It is a `string[]`. Mutate in place — push, unshift, splice, replace elements. Each entry becomes one `role: "system"` message.

### 3. Where the hook fires

Two call sites, both `yield*`-awaited:

- `packages/opencode/src/session/llm.ts:118-122` — main streaming LLM path (interactive chat AND `opencode serve`).
- `packages/opencode/src/agent/agent.ts:394` — one-shot agent-generation path.

### 4. Server mode is covered

`POST /session/:sessionID/message` (`packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:312-324`) → `SessionPrompt.prompt` → `SessionProcessor.process` → `LLM.stream`, which is the same `session/llm.ts:118` site. **The plugin applies to `opencode serve` automatically.**

### 5. Caching: the 2-part header structure

`session/llm.ts:117-128`:

```ts
const header = system[0]
yield* plugin.trigger(
  "experimental.chat.system.transform",
  { sessionID: input.sessionID, model: input.model },
  { system },
)
// rejoin to maintain 2-part structure for caching if header unchanged
if (system.length > 2 && system[0] === header) {
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}
```

**Implications:**

- `append` (with `position: "end"`, default): preserves `system[0]`, so opencode rejoins the tail into one string. Prompt caching is preserved.
- `append` with `position: "start"` (`unshift`): mutates `system[0]`. Rejoin is skipped — your prepended text becomes the new header, and the old header is now in the tail. Caching shape changes.
- `replace`: clears `system[0]`. Rejoin is skipped. Caching shape changes.

This is a documentation point, not a blocker. Call it out in the README.

### 6. Per-model base prompt selection is substring match on `model.api.id`

`packages/opencode/src/session/system.ts:19-33`:

```ts
export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) return [PROMPT_CODEX]
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}
```

**Consequence for the qwen use case:** there is no `qwen.txt` on `dev` anymore. PR #18140 (commit `8ee939c74`, March 2026) renamed `qwen.txt` → `default.txt` and trimmed it. Qwen, DeepSeek, Llama, Mistral, and any other non-matching model now share `PROMPT_DEFAULT`. So overriding "the qwen prompt" really means overriding the default prompt for whichever qwen `model.id` the user is on (e.g. `qwen3-coder`).

### 7. Hook can be sync or async

The trigger awaits non-promises automatically (`packages/opencode/src/plugin/index.ts:271`).

### 8. Plugin auto-discovery

`packages/opencode/src/config/plugin.ts:26-38`:

```ts
for (const item of await Glob.scan("{plugin,plugins}/*.{ts,js}", {
  cwd: dir,
  absolute: true,
  ...
}))
```

**Non-recursive** (single `*`, not `**`). The scan runs once per `.opencode/` directory found by walking up from cwd to the worktree root, plus `~/.opencode/` and `$OPENCODE_CONFIG_DIR` (`packages/opencode/src/config/paths.ts:23-41`). So:

- `.opencode/plugin/system-prompt-override.ts` ✅
- `.opencode/plugins/system-prompt-override.ts` ✅
- `.opencode/plugin/nested/foo.ts` ❌ (not picked up)
- `~/.opencode/plugin/system-prompt-override.ts` ✅ (user-global)

Explicit declaration via `opencode.json` is also supported: `"plugin": ["./path.ts", "npm-pkg", ["npm-pkg", { opts }]]`.

### 9. `PluginInput.directory` is the project directory

`packages/plugin/src/index.ts:56-66`:

```ts
export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  // ...
}
```

Use `input.directory` as the base when looking up the user's config file.

### 10. Existing test reference

`packages/opencode/test/plugin/trigger.test.ts:75-123` shows the trigger working end-to-end. Mimic the `withProject` harness for the integration test, but **pass the correct production-shaped model object** (`{ id, providerID, api: { id, ... }, ... }`) — not the `{ providerID, modelID }` literal the existing test uses.

---

## Configuration design

The plugin reads a config file. **Strict JSON only — no JSONC, no comments.** A regex-based JSONC stripper would corrupt inline prompts containing `//`, `https://`, or `/* */`. Users who want long, documented prompts move them to a `promptFile`.

Default lookup order:

1. `OPENCODE_SYSTEM_PROMPT_CONFIG` environment variable (absolute path)
2. `<input.directory>/.opencode/system-prompts.json` (project-local, preferred)
3. `~/.config/opencode/system-prompts.json` (user-global fallback)
4. `~/.opencode/system-prompts.json` (alt user-global; matches opencode's own walk)

If none exist, the plugin is a no-op. The hook handler is wrapped in a try/catch so unexpected throws never escape to opencode (which would surface them as chat errors).

### Config schema

The user-facing config uses `modelID` as the field name (friendlier, matches the spec's mental model), and the plugin maps it to the runtime field `model.id` internally. `providerID` is unchanged.

```json
{
  "$schema": "./system-prompts.schema.json",
  "lenient": false,
  "default": {
    "mode": "append",
    "prompt": "Always be concise."
  },
  "rules": [
    {
      "match": {
        "providerID": "anthropic",
        "modelID": "claude-sonnet-4-6"
      },
      "mode": "append",
      "position": "end",
      "prompt": "You are operating in a BeyondTrust security context. Follow least-privilege."
    },
    {
      "match": { "providerID": "openai" },
      "mode": "replace",
      "prompt": "You are a terse code assistant. No preamble."
    },
    {
      "match": { "modelID": "qwen3-coder" },
      "mode": "replace",
      "promptFile": "./prompts/qwen-override.md"
    }
  ]
}
```

### Schema rules

- Exactly one of `prompt` or `promptFile` per rule. `promptFile` is resolved relative to the config file's directory.
- `match` may include `providerID`, `modelID`, both, or neither. AND-semantics. A rule with no `match` matches every model.
- Field mapping: `match.modelID` is compared against `model.id` from the hook input. `match.providerID` is compared against `model.providerID`.
- Comparison is **exact string match** for v1. (See stretch goal below.)
- Rules are evaluated in declared order. **All matching explicit rules apply, in order.**
- A `mode: "replace"` rule wipes `output.system` first, then writes its prompt. Subsequent matching rules apply on top.
- **`default` runs only when no explicit rule matched.** (Deliberate choice — see "Design decisions" below.)
- Invalid rule → fail-loud by default (see error model below). Never crash opencode.

### Root-level `lenient` flag

Optional, defaults to `false`. Controls the error model — see the design doc and the README for the full behavior matrix. Short version: by default, config/rule errors inject a visible `<SYSTEM POLICY ERROR>` block into the system prompt. `"lenient": true` suppresses **only** that injected block. The two reporting channels — the log file and a structured `console.error` line to stderr — are always on, in both modes.

### Stretch goal (not required for v1)

Wildcard/regex matching: support `"modelIDGlob": "qwen*"` or `"modelIDRegex": "^claude-"`. Skip if non-trivial — exact match is enough to unblock the immediate qwen use case.

---

## Design decisions (locked)

These resolve open questions from the previous spec draft:

1. **Config uses `modelID`, runtime uses `model.id`.** The plugin maps `match.modelID` → `model.id` internally. Users never see `id`. Document this clearly so nobody chases the discrepancy.
2. **`default` is a fallback, not an overlay.** It applies only when zero explicit rules matched. If you want a global overlay, write an explicit rule with empty `match: {}` (or omit `match`) — that gives "always apply" semantics and stacks with other rules.
3. **Append at end is the default.** It preserves prompt-cache shape. `position: "start"` and `mode: "replace"` are available but documented as cache-breaking.
4. **No hot-reload beyond mtime polling.** Use `fs.statSync` on the config path inside the hook and re-read if mtime changed. Cheap, no watchers.
5. **No silent failures.** Every config error is reported unconditionally on two channels — a JSON line to the log file and one structured `console.error` line to stderr (`[opencode-sysprompt-override] error code=... ruleIndex=... path=... msg="..."`) — independent of `lenient`. Plugin never throws out of the hook.

---

## Implementation

### File layout (project-local install)

```
.opencode/plugin/system-prompt-override.ts   # the plugin (auto-discovered)
.opencode/system-prompts.json                # user's config
.opencode/system-prompts.schema.json         # JSON schema for editor autocomplete
.opencode/system-prompts.example.json        # annotated example
```

If published as an npm package instead, replace `system-prompt-override.ts` with the package entry, and the user adds `"plugin": ["@me/opencode-system-prompts"]` to `opencode.json`.

### Plugin skeleton

```ts
// .opencode/plugin/system-prompt-override.ts
import type { Plugin } from "@opencode-ai/plugin"
import { readFile, stat } from "node:fs/promises"
import { existsSync, statSync } from "node:fs"
import { resolve, dirname, isAbsolute, join } from "node:path"
import { homedir } from "node:os"

type Mode = "append" | "replace"
type Position = "start" | "end"

interface MatchSpec {
  providerID?: string
  modelID?: string  // compared against model.id at runtime
}

interface Rule {
  match?: MatchSpec
  mode: Mode
  position?: Position
  prompt?: string
  promptFile?: string
}

interface Config {
  default?: Omit<Rule, "match">
  rules?: Rule[]
}

interface LoadedConfig {
  path: string
  dir: string
  mtimeMs: number
  cfg: Config
}

let cached: LoadedConfig | null = null

export default (async (ctx) => {
  return {
    "experimental.chat.system.transform": async (input, output) => {
      const loaded = await loadConfigIfChanged(ctx.directory)
      if (!loaded) return

      // model is the production Provider.Model — has .id, NOT .modelID
      const model = input.model as { providerID: string; id: string }
      const explicit = (loaded.cfg.rules ?? []).filter((r) => matches(r, model))

      let anyMatched = false
      for (const rule of explicit) {
        const text = await resolvePromptText(rule, loaded.dir)
        if (text == null) continue
        anyMatched = true
        applyRule(rule, text, output)
      }

      if (!anyMatched && loaded.cfg.default) {
        const text = await resolvePromptText(loaded.cfg.default, loaded.dir)
        if (text != null) applyRule(loaded.cfg.default, text, output)
      }
    },
  }
}) satisfies Plugin

function matches(rule: Rule, model: { providerID: string; id: string }): boolean {
  if (!rule.match) return true
  if (rule.match.providerID && rule.match.providerID !== model.providerID) return false
  if (rule.match.modelID && rule.match.modelID !== model.id) return false
  return true
}

function applyRule(rule: Omit<Rule, "match">, text: string, output: { system: string[] }) {
  if (rule.mode === "replace") {
    output.system.splice(0, output.system.length, text)
  } else if (rule.mode === "append") {
    if (rule.position === "start") output.system.unshift(text)
    else output.system.push(text)
  } else {
    console.warn(`[system-prompt-override] unknown mode: ${(rule as any).mode}`)
  }
}

async function resolvePromptText(
  rule: Omit<Rule, "match">,
  configDir: string,
): Promise<string | null> {
  const hasPrompt = typeof rule.prompt === "string"
  const hasFile = typeof rule.promptFile === "string"
  if (hasPrompt === hasFile) {
    console.warn("[system-prompt-override] rule must have exactly one of prompt/promptFile")
    return null
  }
  if (hasPrompt) return rule.prompt!
  const filePath = isAbsolute(rule.promptFile!)
    ? rule.promptFile!
    : resolve(configDir, rule.promptFile!)
  try {
    return await readFile(filePath, "utf8")
  } catch (err) {
    console.warn(`[system-prompt-override] could not read promptFile ${filePath}:`, err)
    return null
  }
}

async function loadConfigIfChanged(projectDir: string): Promise<LoadedConfig | null> {
  const candidates = configCandidates(projectDir)
  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    cached = null
    return null
  }

  const st = statSync(found)
  if (cached && cached.path === found && cached.mtimeMs === st.mtimeMs) {
    return cached
  }

  try {
    const raw = await readFile(found, "utf8")
    const cfg = parseJsonc(raw)
    cached = { path: found, dir: dirname(found), mtimeMs: st.mtimeMs, cfg }
    return cached
  } catch (err) {
    console.warn(`[system-prompt-override] failed to load ${found}:`, err)
    cached = null
    return null
  }
}

function configCandidates(projectDir: string): string[] {
  const env = process.env.OPENCODE_SYSTEM_PROMPT_CONFIG
  return [
    env,
    join(projectDir, ".opencode", "system-prompts.json"),
    join(homedir(), ".config", "opencode", "system-prompts.json"),
    join(homedir(), ".opencode", "system-prompts.json"),
  ].filter((p): p is string => !!p)
}
```

Config parsing is plain `JSON.parse`. No JSONC. The error-injection and log-writing logic (`reportError`, `injectErrorBlock`, the `lenient` branch) is omitted from this skeleton for brevity — see the build design doc for the full behavior matrix.

Fill in any gaps as needed. The skeleton above is meant to be ~complete — a coding agent should be able to refine and ship it without redesigning the structure.

### Errors

Default is **fail-loud**: every error injects a `<SYSTEM POLICY ERROR: ...>` block into `output.system`. Independent of mode, every error also appends a JSON line to `<config-dir>/system-prompt-override.log` **and** writes one structured `console.error` line to stderr. `"lenient": true` in the config root suppresses only the injected block (log line and stderr line still written).

Triggers (both modes):

- Config file unreadable
- Malformed JSON
- Rule with both `prompt` and `promptFile`, or neither
- `promptFile` missing or unreadable
- Unknown `mode`
- Bad glob (regex compile fails)
- Unexpected handler exception

In every case: **never throw out of the hook.** opencode would otherwise surface it as a chat error. See the build design doc for the full behavior matrix and error-block format.

---

## Tests

Use Bun's test runner (matches opencode's stack). Tests live in a `test/` directory next to the plugin.

### Unit tests (use the production model shape: `{ id, providerID, ... }`)

1. `append` rule with matching `providerID` adds prompt at end of `output.system`.
2. `append` rule with `position: "start"` unshifts.
3. `replace` rule clears `output.system` and inserts its prompt.
4. Rule with no `match` applies to every model.
5. `match.modelID` only — fires on any provider when `model.id` matches (custom-model case).
6. Multiple matching rules stack in declared order.
7. `default` fires when no explicit rule matches.
8. `default` does NOT fire when at least one explicit rule matched.
9. `promptFile` is loaded relative to the config file's directory.
10. Missing config file → hook is no-op (`output.system` unchanged).
11. Malformed JSON → fail-loud injects `<SYSTEM POLICY ERROR>` block; `lenient: true` warns and no-ops.
12. Rule with both `prompt` and `promptFile` → error block injected, other valid rules still apply.
13. mtime cache: editing config between calls picks up the change without restart.
14. Inline `prompt` containing `https://`, `//`, and `/* ... */` parses correctly (no JSONC stripping pitfalls).
15. Log file at `<config-dir>/system-prompt-override.log` receives one JSON line per error event in both fail-loud and lenient modes.

### Integration test

Mirror `packages/opencode/test/plugin/trigger.test.ts:75-123` (`withProject` harness). Spin up a minimal project with the plugin and a config file, call the trigger directly with a synthetic **production-shaped** model — `{ id: "qwen3-coder", providerID: "openrouter", api: { id: "qwen3-coder", url: "", npm: "" }, name: "...", capabilities: {...}, ... }` — and assert the resulting `output.system` array. **Do not copy the existing test's `{ providerID, modelID }` literal; it is misleading.**

### Manual server-mode smoke test

1. Start `opencode serve` with the plugin and a `replace` rule for the model you'll target.
2. `curl -X POST` the session message endpoint with a prompt like "Repeat your system instructions verbatim."
3. Verify the replacement text appears, not opencode's default.

---

## Deliverables

- `.opencode/plugin/system-prompt-override.ts` — the plugin.
- `.opencode/system-prompts.schema.json` — JSON schema for the config file (with `modelID` field, documenting the `model.id` mapping).
- `.opencode/system-prompts.example.json` — annotated example covering append, replace, default, and a qwen-override rule.
- `README.md` — install, config schema, precedence rules, the caveats below.
- Tests as listed above, all passing under `bun test`.

---

## Caveats to call out in the README

1. **Field naming.** The config uses `modelID`. The opencode runtime field is `model.id`. The plugin maps between them. If you read the opencode source and see `model.id`, that's the same thing.
2. **`experimental.*` namespace.** The hook is `experimental.chat.system.transform`. opencode maintainers may rename it without a major version bump. Pin your opencode version or watch `packages/plugin/src/index.ts` on upgrade.
3. **`replace` mode discards opencode's per-model base prompt** (`session/system.ts:19-33` — anthropic.txt, gpt.txt, gemini.txt, kimi.txt, trinity.txt, default.txt). Those prompts contain tool-use instructions the agent relies on. Prefer `append` unless you genuinely want to take over fully.
4. **Cache-shape impact.** `append` with `position: "end"` (default) preserves opencode's 2-part header structure used for prompt caching (`session/llm.ts:124-128`). `position: "start"` and `mode: "replace"` modify `system[0]`, which skips the rejoin — caching behavior may differ. Stick with the default unless you have a reason.
5. **Hook fires on every LLM call** — chat turns, agent sub-runs, HTTP server requests. There is no separate hook for any of these.
6. **`input.sessionID` is optional.** The agent path passes it; some agent-generation paths may not. Don't rely on it for matching.
7. **No `qwen.txt` anymore.** As of March 2026 (PR #18140), opencode renamed `qwen.txt` → `default.txt` and trimmed it. Qwen, DeepSeek, Llama, Mistral, etc. all use `default.txt`. To override "the qwen prompt," target the specific `modelID` (e.g. `qwen3-coder`) — not a provider — because the same `default.txt` is shared by many models.

---

## Out of scope for v1

- Hot-reload UX beyond mtime polling.
- Token counting / truncation of injected prompts.
- Per-session or per-conversation overrides (would require a different hook surface).
- Mutating `chat.params` (temperature, etc.) — different hook, different plugin.
- Wildcard/regex matching (listed as a stretch goal above).
