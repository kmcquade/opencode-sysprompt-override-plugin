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
| Wildcard matching in v1 | Yes — glob (`*`, `?`) only; no regex |
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
├── config.ts       # discovery, load, mtime cache, JSONC stripping
├── match.ts        # rule matching: exact + glob, AND-semantics
├── apply.ts        # mutation: replace, append at start/end
└── glob.ts         # tiny glob → RegExp (~10 lines)

test/
├── match.test.ts
├── apply.test.ts
├── config.test.ts
├── glob.test.ts
└── integration.test.ts   # invokes the built plugin against a synthetic Provider.Model

schemas/system-prompts.schema.json
examples/system-prompts.example.jsonc
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

Add glob fields:

```jsonc
{
  "match": {
    "providerID": "exact-match",
    "providerIDGlob": "anthropic*",
    "modelID": "exact-match",      // compared against model.id at runtime
    "modelIDGlob": "qwen*"
  }
}
```

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

## JSONC stripping

Hand-rolled in `src/config.ts`. Acceptable for short plugin configs; switch to `jsonc-parser` if anyone hits an edge case.

```ts
function stripJsonc(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")       // block comments
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1")    // line comments (avoid URLs)
}
```

Known limitation: `//` inside a JSON string value is mishandled. Acceptable for v1.

## Error handling

Everything degrades to a `console.warn` + skip. The hook handler is wrapped in a try/catch so unexpected throws don't surface as opencode chat errors.

| Condition | Behavior |
|---|---|
| No config file found | Silent no-op |
| Config file unreadable | Warn once, no-op |
| Malformed JSON/JSONC | Warn once, no-op |
| Rule with both `prompt` and `promptFile`, or neither | Warn with rule index, skip rule |
| `promptFile` missing or unreadable | Warn with path, skip rule |
| Unknown `mode` | Warn with rule index, skip rule |
| Bad glob (regex compile fails) | Warn with pattern, skip rule |
| Hook handler throws unexpectedly | Caught, warn, no-op for that call |

Warnings include the config path and rule index where applicable. Each unique warning fires at most once per config load (deduped on `(message, path)`) so logs aren't spammed on every LLM call.

## Testing strategy

### Unit tests (no opencode dep)

- `match.test.ts` — exact `providerID`/`modelID`, glob variants, AND semantics, empty `match` matches everything.
- `apply.test.ts` — append-end, append-start, replace, multiple rules stacking, replace-then-append sequence.
- `config.test.ts` — discovery order (env var > project `.opencode/` > `~/.config/opencode/` > `~/.opencode/`), JSONC comment stripping, mtime cache hit/miss, malformed JSON warns and returns null.
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

Two scenarios:

1. **Happy path:** explicit qwen rule + `default` rule → only qwen rule fires; `default` is skipped.
2. **Replace then append:** qwen replace rule + global append rule (no `match`) → both apply in order; `output.system` ends up as `[replaced, appended]`.

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
8. `schemas/system-prompts.schema.json`, `examples/system-prompts.example.jsonc`.
9. `.github/workflows/ci.yml`.
10. `README.md` — install, config, drop-in instructions, caveats from `SPEC.md`.
