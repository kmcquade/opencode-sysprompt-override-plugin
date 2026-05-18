# Build Design — opencode-sysprompt-override

**Date:** 2026-05-18
**Status:** Approved
**Companion doc:** [`SPEC.md`](../../../SPEC.md) — defines the plugin's runtime behavior (hook contract, config schema, matching rules). This document covers **how we build, test, package, and ship** that plugin.

## Decisions

| Question | Decision |
|---|---|
| Distribution | Publishable npm package |
| Runtime target | Bun (matches opencode) |
| Runtime dependencies | Zero |
| Config format | Strict JSON only — no JSONC |
| Wildcard matching in v1 | Yes — glob (`*`, `?`) only; no regex |
| Error model | Fail-loud by default; `"lenient": true` opts into warn-and-skip |
| Test depth | Unit + integration (no opencode dev dep) |
| CI principle | Local-CI parity — GH Actions wraps `make` targets, nothing else |

## Architecture

Single npm package, Bun-native. Source in `src/`, built with `bun build` to a single ESM bundle plus a `.d.ts` file emitted by `tsc --emitDeclarationOnly`. `@opencode-ai/plugin` is a peer dependency — needed for types only, no runtime cost.

Two install paths for consumers:

1. **npm install:** `npm install opencode-sysprompt-override`, then add `"plugin": ["opencode-sysprompt-override"]` to `opencode.json`.
2. **Drop-in:** copy `dist/index.js` into `.opencode/plugin/` directly. Useful for users who want to vendor the plugin without a package.json.

Package name: `opencode-sysprompt-override` (unscoped). Initial version: `0.1.0`. SemVer.

## Module layout

```
src/
├── index.ts        # plugin factory; wires the hook handler
├── config.ts       # discovery, load (JSON.parse), mtime cache, schema validation
├── match.ts        # rule matching: exact + glob, AND-semantics
├── apply.ts        # mutation: replace, append at start/end
├── glob.ts         # tiny glob → RegExp (~10 lines)
├── errors.ts       # fail-loud vs lenient: inject SYSTEM POLICY ERROR blocks, write log file
└── log.ts          # append-only log file writer (~/.opencode/system-prompt-override.log)

test/
├── match.test.ts
├── apply.test.ts
├── config.test.ts
├── glob.test.ts
├── errors.test.ts        # fail-loud injection, lenient skip, log writes
└── integration.test.ts   # invokes the built plugin against a synthetic Provider.Model

schemas/system-prompts.schema.json
examples/system-prompts.example.json
package.json
tsconfig.json
bunfig.toml
Makefile
.github/workflows/ci.yml
README.md
```

Each module has one job and is independently testable. `glob.ts` is its own file because globs are easy to get subtly wrong and deserve a dedicated test surface.

## Public surface

- **Default export** from the package entry: a `Plugin` (per `@opencode-ai/plugin`).
- **No named exports** in v1. Single hook, no programmatic API to expose.

## Data flow per LLM call

1. opencode discovers the plugin (auto-discovery from `.opencode/plugin/` or via `opencode.json`).
2. Calls the factory with `PluginInput`; the factory returns `{ "experimental.chat.system.transform": handler }`.
3. On every LLM call, opencode invokes the handler with `{ sessionID?, model }` and a mutable `{ system: string[] }`.
4. Handler executes:
   1. `loadConfigIfChanged(input.directory)` — `statSync` on the cached config path; cache-hit returns the parsed config; cache-miss re-reads and re-parses.
   2. If no config file exists → return (no-op).
   3. Filter `cfg.rules` through `matches(rule, model)` (exact + glob, AND across populated fields).
   4. For each matching rule in declared order: resolve prompt text (inline `prompt` or `promptFile`), call `applyRule(rule, text, output.system)`.
   5. If zero explicit rules matched and `cfg.default` exists → apply `default` as a fallback.
5. opencode rejoins the tail entries when `system[0]` is unchanged, preserving the 2-part prompt-cache structure (verified at `session/llm.ts:124-128`).

**Hot-path cost (warm cache):** one `statSync`, zero allocations. Glob `RegExp`s are compiled once and cached on the parsed rule.

**Cold path:** one `readFile` of the config plus one `readFile` per matching `promptFile` rule. `promptFile` content is also cached keyed by `(path, mtime)`.

## Config schema additions over `SPEC.md`

### Glob fields

```json
{
  "match": {
    "providerID": "exact-match",
    "providerIDGlob": "anthropic*",
    "modelID": "exact-match",
    "modelIDGlob": "qwen*"
  }
}
```

### Root-level `lenient` flag

```json
{
  "lenient": false,
  "default": { "mode": "append", "prompt": "..." },
  "rules": [ ... ]
}
```

Default is `false` (fail-loud). Set to `true` to opt into warn-and-skip behavior described in the Error Handling section.

Semantics:

- Inside a single `match`, all populated fields AND together.
- `providerID` and `providerIDGlob` are mutually exclusive in the JSON Schema (via `oneOf`) so editors nudge users into a single style. Same for `modelID` vs `modelIDGlob`. At runtime, if both are set anyway, both must match — harmless defensive behavior.
- `default` rule still fires only when zero explicit rules matched.
- Each rule still requires exactly one of `prompt` or `promptFile`. Inline `prompt` is the common case; `promptFile` exists for long prompts that would be painful to JSON-escape. `promptFile` content is **not** auto-packaged with the plugin — it's a user-maintained file. If missing, the plugin warns and skips that rule.

## Glob implementation

Hand-rolled in `src/glob.ts`. Supports `*` (zero or more of any character) and `?` (exactly one), with all other regex metacharacters escaped. No path-segment semantics — model IDs aren't paths.

```ts
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  const regex = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  return new RegExp(regex)
}
```

Compiled `RegExp`s are cached on the parsed rule so we don't recompile per LLM call.

## Config format: strict JSON only

**No JSONC support.** Configs are parsed with `JSON.parse` directly. Rationale: a regex-based JSONC stripper corrupts inline prompts containing `//`, `https://`, or `/* */` — exactly the content users routinely put in prompts. A real JSONC parser would add a runtime dep. JSON is good enough: users who want long, documented prompts move them to a `promptFile`, where the content can be anything.

The example file is `system-prompts.example.json`. No `.jsonc` extension is recognized.

## Error handling: fail-loud by default

The plugin's job is to enforce custom system instructions. Silent failure means a security overlay or `replace` rule can disappear and the operator never finds out — exactly the failure mode Codex flagged. Default behavior is therefore **fail-loud**: every error injects a clearly-formatted `<SYSTEM POLICY ERROR>` block into `output.system` so it surfaces in the chat, and writes to a durable log file.

Users who specifically want quiet behavior (active development, intentional rule omission) opt in via `"lenient": true` at the config root.

### Behavior matrix

| Condition | Default (fail-loud) | `"lenient": true` |
|---|---|---|
| No config file found | Silent no-op (this is the default state, not an error) | Same |
| Config file unreadable | Inject `<SYSTEM POLICY ERROR: cannot read $path: $reason>`, log, no rules applied | `console.warn` once, no-op |
| Malformed JSON | Inject `<SYSTEM POLICY ERROR: invalid JSON in $path: $reason>`, log, no rules applied | Warn once, no-op |
| Rule with both `prompt` and `promptFile`, or neither | Inject `<SYSTEM POLICY ERROR: rule[$i] invalid shape: ...>`, log, skip rule, apply others | Warn with rule index, skip rule |
| `promptFile` missing or unreadable | Inject `<SYSTEM POLICY ERROR: rule[$i] promptFile $path: $reason>`, log, skip rule, apply others | Warn with path, skip rule |
| Unknown `mode` | Inject `<SYSTEM POLICY ERROR: rule[$i] unknown mode $mode>`, log, skip rule, apply others | Warn with rule index, skip rule |
| Bad glob (regex compile fails) | Inject `<SYSTEM POLICY ERROR: rule[$i] bad glob $pattern: $reason>`, log, skip rule, apply others | Warn with pattern, skip rule |
| Hook handler throws unexpectedly | Caught at top of handler; inject `<SYSTEM POLICY ERROR: handler crash: $reason>`, log; remaining rules not applied | Caught, warn, no-op for that call |

The hook handler is always wrapped in a try/catch — neither mode lets exceptions escape to opencode (that would surface as a chat error from opencode itself, which is worse than our controlled error block).

### Error block format

Each error is prepended to `output.system` as a separate entry so it's visible at the start of the system prompt:

```
<SYSTEM POLICY ERROR: rule[2] promptFile ./prompts/security.md: ENOENT>
The opencode-sysprompt-override plugin failed to apply this rule. See ~/.opencode/system-prompt-override.log for details.
```

`unshift`ing the error means `system[0]` is mutated, which intentionally breaks opencode's prompt-cache rejoin — operators get cache-shape evidence of policy failure on top of the visible message. Cache breakage is the correct cost for a broken policy.

In `lenient` mode, error blocks are not injected; only the log file and `console.warn` capture the failure.

### Log file

Always-on, regardless of `lenient` setting. Location: `<config-dir>/system-prompt-override.log`, where `<config-dir>` is the directory the active config was loaded from (project `.opencode/` or `~/.opencode/`). Format: one JSON line per error event with `timestamp`, `path`, `ruleIndex` (if applicable), `code`, `message`.

Append-only. Users are responsible for rotation. v1 does not cap log size.

### Warning de-duplication

Within a single config load, identical errors fire once per `(code, path, ruleIndex)` key to avoid log spam on every LLM call. The dedupe cache is reset when the config file's mtime changes (because the user has likely fixed or changed the problem).

## Testing strategy

### Unit tests (no opencode dep)

- `match.test.ts` — exact `providerID`/`modelID`, glob variants, AND semantics, empty `match` matches everything.
- `apply.test.ts` — append-end, append-start, replace, multiple rules stacking, replace-then-append sequence.
- `config.test.ts` — discovery order (env var > project `.opencode/` > `~/.config/opencode/` > `~/.opencode/`), mtime cache hit/miss, JSON-only parsing (a `.jsonc` file with comments is treated as malformed). Includes tests with inline prompts containing `https://`, `//`, and `/* ... */` to confirm `JSON.parse` handles them correctly.
- `glob.test.ts` — `*`, `?`, literal regex metacharacters escaped, anchored full-string match.

### Integration test

Loads the built plugin via dynamic import, calls the factory with a fake `PluginInput` (only `directory` is required for our handler), gets the hooks object back, invokes the hook with a **production-shaped** synthetic `Provider.Model`:

```ts
const model = {
  id: "qwen3-coder",
  providerID: "openrouter",
  api: { id: "qwen3-coder", url: "", npm: "" },
  name: "Qwen3 Coder",
  capabilities: { /* ... */ },
  // ...
}
```

Three scenarios:

1. **Happy path:** explicit qwen rule + `default` rule → only qwen rule fires; `default` is skipped.
2. **Replace then append:** qwen replace rule + global append rule (no `match`) → both apply in order; `output.system` ends up as `[replaced, appended]`.
3. **Fail-loud on broken rule:** a rule with a missing `promptFile` → `<SYSTEM POLICY ERROR>` block is prepended; valid sibling rules still apply; log file at `<config-dir>/system-prompt-override.log` gains one JSON line. Same scenario with `"lenient": true` → no error block injected; log file still gets the line.

This exercises the real plugin entry point, real config loading, real glob matching, and real file I/O. The only synthesized things are the `Model` object and the empty `output.system` — which is exactly what opencode itself supplies at the call site.

**Why not pull in opencode as a dev dep:** opencode is a Bun monorepo with non-trivial setup. The hook contract is simple enough that invoking our plugin directly with the right input shapes covers everything that would matter in a real opencode run.

## Build, CI, and release

### Makefile (single source of truth for local + CI)

```make
.PHONY: install test build ci clean publish

install:
	bun install

test:
	bun test

build:
	bun build src/index.ts --target=bun --outdir=dist --format=esm
	bun x tsc --emitDeclarationOnly --outDir dist

ci: install test build

clean:
	rm -rf dist node_modules

publish: ci
	bun publish
```

### CI principle: local-parity

**Nothing in GitHub Actions that can't be run locally with a single Make target.** The workflow installs Bun, then runs `make ci`. No inline scripts, no env-only logic, no GHA-specific commands. To reproduce a CI failure locally, you type `make ci`.

Practical consequences:

- Every CI step has a corresponding Make target.
- Anything env-dependent (e.g. `NPM_TOKEN` for publish) gets a Make target that reads the same env var locally. Same code path.
- New CI checks land as Make targets first; the workflow gets one more line referencing the new target.
- README documents `make ci` as the canonical "is my PR going to pass" check.

### GH Actions

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: make ci
```

That is the entire workflow. Triggers on push and PR; no matrix.

### package.json scripts

- `test` → `bun test`
- `build` → same command as `make build`
- `prepublishOnly` → `make ci`

### Release flow

Manual, low-cadence, single-maintainer:

1. Bump `version` in `package.json`.
2. Update `CHANGELOG.md` if one exists.
3. Tag `vX.Y.Z`, push tag.
4. Run `make publish` locally.

No automated release workflow in v1.

## Changes from Codex adversarial review (2026-05-18)

Codex flagged two `[high]` issues against an earlier revision of this document. Both are now addressed:

1. **Regex-based JSONC stripping would corrupt inline prompts containing `//`, `https://`, or `/* */`.** Resolution: dropped JSONC entirely. `JSON.parse` only. Users who want long, documented prompts use `promptFile`. See "Config format: strict JSON only" above.
2. **Fail-open error model could silently disable security-critical overrides.** Resolution: default is now fail-loud — every error injects a visible `<SYSTEM POLICY ERROR>` block into `output.system` and writes to an append-only log file. `"lenient": true` is the explicit opt-out for development use. See "Error handling: fail-loud by default" above.

## Out of scope for v1

- Regex matching (`modelIDRegex`, `providerIDRegex`) — glob covers the immediate need; revisit if asked.
- Automated npm publish workflow.
- Per-session or per-conversation overrides — would require a different hook surface.
- Hot reload beyond mtime polling.
- Mutating `chat.params` (temperature, etc.) — different hook, different plugin.

## File-by-file build order (for the implementation plan)

This is a sketch for the writing-plans skill, not a binding sequence:

1. `package.json`, `tsconfig.json`, `bunfig.toml`, `Makefile` — project skeleton.
2. `src/glob.ts` + `test/glob.test.ts` — smallest unit, no deps.
3. `src/match.ts` + `test/match.test.ts` — depends on glob.
4. `src/apply.ts` + `test/apply.test.ts` — pure mutation logic.
5. `src/config.ts` + `test/config.test.ts` — discovery, JSONC, mtime cache.
6. `src/index.ts` — wires everything; exports the plugin factory.
7. `test/integration.test.ts` — uses the built plugin.
8. `src/log.ts` + `src/errors.ts` + `test/errors.test.ts` — error injection and log writes.
9. `schemas/system-prompts.schema.json`, `examples/system-prompts.example.json`.
10. `.github/workflows/ci.yml`.
11. `README.md` — install, config, drop-in instructions, error model (fail-loud default), caveats from `SPEC.md`.
