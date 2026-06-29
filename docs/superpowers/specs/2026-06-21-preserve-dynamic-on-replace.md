# Build Design — preserveDynamic on replace

**Date:** 2026-06-21
**Status:** Approved
**Companion doc:** [`SPEC.md`](../../../SPEC.md) — defines the plugin's runtime behavior (hook contract, config schema, matching rules). This document covers **why and how we add the preserveDynamic feature** to the replace mode, including the configurable boundary markers that keep opencode's runtime-generated sections (env, instructions, skills) intact.

**Companion plan:** [`docs/superpowers/plans/2026-06-21-preserve-dynamic-on-replace.md`](../plans/2026-06-21-preserve-dynamic-on-replace.md) — step-by-step implementation instructions.

## Decisions

| Question | Decision |
|---|---|
| Boundary detection strategy | String scanning — opencode exposes no plugin API to regenerate dynamic sections |
| Boundary marker source | opencode's own `SystemPrompt.environment()` output as named constants |
| Markers configurable? | Yes — both primary and fallback are overridable via top-level config keys |
| Marker config scope | Top-level only (not per-rule) — prompt assembly format is the same regardless of which rule matched |
| Default for `preserveDynamic` | `false` — existing configs behave identically, zero migration |
| Fallback when markers not found | Graceful degradation to full splice (same as `preserveDynamic: false`) |

## Research findings

The `experimental.chat.system.transform` hook receives only `{ sessionID, model }` as input and `{ system: string[] }` as output. opencode does **not** expose any API to regenerate the dynamic sections (env, instructions, skills). The internal generators (`SystemPrompt.Service.environment`, `SystemPrompt.Service.skills`, `Instruction.Service.system`) are Effect service methods not available to plugins. String-boundary detection is therefore the only viable strategy.

At hook time, `output.system` is `[singleString]` — a single element containing the `\n`-joined concatenation of: provider base prompt (or agent custom prompt) → env block → instructions → skills listing → user system override. The boundaries between these sections are implicit in the string.

## Architecture

A new optional boolean `preserveDynamic` on `Rule` (defaults to `false`). A new `src/constants.ts` file holds the default boundary markers as named exports. Two new top-level config keys (`dynamicBoundaryMarker`, `dynamicFallbackMarker`) allow overriding the markers. A new helper function `findDynamicBoundary` scans `output.system[0]` for the markers and returns the splice point.

When `mode === "replace" && preserveDynamic === true`:
1. Read `output.system[0]` — the full concatenated prompt string.
2. Search for the primary marker. If found, replace everything before it with the rule's prompt text; everything from the marker onward (the dynamic sections) is preserved.
3. If primary marker not found, search for the fallback marker. Same logic.
4. If neither marker is found, fall back to full `splice` (original replace behavior).

When `preserveDynamic` is `false` (whether explicitly or by default), the existing code path runs unchanged — bit-identical behavior.

## Marker sources

Both default markers come from opencode's own source, confirmed against `repos/opencode` on `dev`:

1. **Primary** (`DEFAULT_DYNAMIC_BOUNDARY`): `'\nYou are powered by the model named'` — the first line of `SystemPrompt.environment()` (`packages/opencode/src/session/system.ts`), emitted for every model.
2. **Fallback** (`DEFAULT_FALLBACK_DYNAMIC_BOUNDARY`): `'\n<env>'` — the XML tag wrapping the environment detail block. Provides resilience if opencode changes the env wording but keeps the XML structure.

If opencode changes both markers in a future version, `findDynamicBoundary` returns `-1` and the feature degrades gracefully to the full-splice fallback — same behavior as `preserveDynamic: false`.

## Module layout

Addition and modifications to the existing layout:

```
src/
├── constants.ts  ← NEW: default boundary markers as named exports
├── apply.ts      ← MODIFIED: add findDynamicBoundary, extend applyRule params
├── config.ts     ← MODIFIED: parse new top-level keys, add to LoadedConfig
├── types.ts      ← MODIFIED: add fields to Config, Rule, ParsedRule
└── index.ts      ← MODIFIED: pass markers from LoadedConfig to applyRule

test/
├── apply.test.ts       ← MODIFIED: add preserveDynamic test cases
└── integration.test.ts ← MODIFIED: add preserveDynamic + custom marker scenarios

schemas/
└── system-prompts.schema.json  ← MODIFIED: add preserveDynamic + marker fields
```

No new runtime dependencies. No build step changes.

## Public surface addition

- `Rule.preserveDynamic?: boolean` — per-rule flag on the existing `Rule` config shape.
- `Config.dynamicBoundaryMarker?: string` — top-level override for the primary marker.
- `Config.dynamicFallbackMarker?: string` — top-level override for the fallback marker.

## Config schema additions

### Per-rule `preserveDynamic`

```json
{
  "match": { "modelIDGlob": "qwen*" },
  "mode": "replace",
  "preserveDynamic": true,
  "prompt": "You are a terse code assistant."
}
```

When `true` and `mode: "replace"`, only the provider/base-prompt portion of `output.system[0]` is replaced; everything from the dynamic boundary onward (env, instructions, skills) is preserved.

### Top-level marker overrides

```json
{
  "dynamicBoundaryMarker": "\nYou are powered by the model named",
  "dynamicFallbackMarker": "\n<env>",
  "rules": [
    {
      "match": { "modelIDGlob": "qwen*" },
      "mode": "replace",
      "preserveDynamic": true,
      "prompt": "You are a terse code assistant."
    }
  ]
}
```

Both are optional. When absent, `src/constants.ts` provides the defaults. The override is resolved once at config load time (not per-LLM-call).

### No interaction with `lenient`

`preserveDynamic` and `lenient` are orthogonal. `preserveDynamic` governs whether dynamic sections are preserved during a replace. `lenient` governs whether errors inject a visible `<SYSTEM POLICY ERROR>` block. Neither affects the other.

### No interaction with `default` rule

The `default` rule can also set `preserveDynamic`. Since `default` is a regular `ParsedRule` under the hood, it flows through the same `applyRule` path.

## Data flow changes

Modified step 4 from the original spec. The handler now:

1. `loadConfigIfChanged(input.directory)` — unchanged.
2. If no config file → no-op — unchanged.
3. Filter `cfg.rules` through `matches(rule, model)` — unchanged.
4. For each matching rule: resolve prompt text, call **`applyRule(rule, text, output, loaded.dynamicBoundaryMarker, loaded.dynamicFallbackMarker)`**.
5. If zero explicit rules matched and `cfg.default` exists → apply default with same marker params.
6. opencode rejoins tail entries when `system[0]` is unchanged — **if `preserveDynamic` is true, `system[0]` is modified (replacement text spliced before the dynamic sections), so the rejoin is skipped.** This is the same cache-shape caveat as the existing `replace` mode.

**Hot-path cost (preserveDynamic = true, warm cache):** one `indexOf` on a string (the boundary scan). Negligible.

**Hot-path cost (preserveDynamic = false, warm cache):** zero change from baseline.

## Boundary scanning strategy

The `findDynamicBoundary` function is a pure function that accepts the full prompt string plus optional marker overrides:

```ts
export function findDynamicBoundary(
  fullPrompt: string,
  marker: string = DEFAULT_DYNAMIC_BOUNDARY,
  fallbackMarker: string = DEFAULT_FALLBACK_DYNAMIC_BOUNDARY,
): number
```

Strategy:
1. Try primary marker first (e.g. `'\nYou are powered by the model named'`). If found at index `N`, the dynamic sections start at `N`. Return `N`.
2. If primary not found, try fallback marker (e.g. `'\n<env>'`). If found at index `M`, walk backward to the last `\n` before `M` (to avoid mid-line slicing). Return that newline position, or `M` if no newline precedes it.
3. If neither found, return `-1`.

The two-level search means the plugin can survive a cosmetic wording change to opencode's env line (e.g. "You are running on model" instead of "You are powered by the model named") so long as the `<env>` XML element survives.

## Testing strategy additions

### Unit tests (apply.test.ts)

New test cases for `applyRule`:

- `preserveDynamic: true` with primary boundary present → only provider prompt replaced, dynamic sections preserved.
- `preserveDynamic: true` with only fallback boundary present → same result via fallback path.
- `preserveDynamic: true` with custom marker passed via parameter → uses custom marker.
- `preserveDynamic: true` with no boundary found → falls back to full splice.
- `preserveDynamic: false` (or not set) → original splice behavior, bit-identical.
- `findDynamicBoundary` returns correct indices for edge cases: marker at start of string, marker not found, fallback only, both present.

### Config tests (config.test.ts)

New test cases:

- Config without `dynamicBoundaryMarker` → `LoadedConfig.dynamicBoundaryMarker` equals `DEFAULT_DYNAMIC_BOUNDARY`.
- Config with `dynamicBoundaryMarker: '\nCustom marker'` → value is used.
- Same for `dynamicFallbackMarker`.

### Integration test

New scenarios:

1. `mode: "replace", preserveDynamic: true` — `output.system[0]` contains env section starting with the default primary marker. Assert replacement text appears at the start AND the env section is preserved at the end.
2. Same with `dynamicBoundaryMarker` set to a custom string — `output.system[0]` contains that custom marker. Assert correct splice.
3. `preserveDynamic: true` with no boundary match → full replace (graceful degradation).

## Out of scope

- API-based regeneration of dynamic sections (opencode doesn't expose one).
- Per-rule boundary markers (top-level only — prompt shape is uniform).
- Hot-reload of marker constants beyond config mtime polling.
- Migration from existing `replace` rules — backwards compatibility is built in; existing configs produce identical behavior without any change.
