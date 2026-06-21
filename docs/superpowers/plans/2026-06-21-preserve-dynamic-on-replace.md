# 2026-06-21-preserve-dynamic-on-replace.md

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (https://github.com/obra/superpowers)

**Goal:** Add an optional `preserveDynamic` flag to `mode: "replace"` rules. When enabled, the replacement text is spliced in at the boundary where opencode's runtime-generated sections (env info, AGENTS.md instructions, skills listing) begin, keeping those sections intact instead of wiping them. Existing configs without this field behave identically to before — full backwards compatibility, zero migration needed.

**Architecture:** A new optional boolean `preserveDynamic` on `Rule` (defaults to `false`). The boundary markers used to locate the dynamic sections live in a new `src/constants.ts` as named exports, and both can be overridden via top-level config keys `dynamicBoundaryMarker` and `dynamicFallbackMarker`. When `mode === "replace" && preserveDynamic === true`, scan `output.system[0]` for the primary marker. If found, replace only the text before it; the dynamic sections remain. If not found, try the fallback marker. If neither is found, fall back to full splice (original behavior). When `preserveDynamic` is `false` (whether explicitly or by default), the existing `splice` path runs unchanged.

**Tech Stack:** Same as project — TypeScript 5.x, Bun 1.x, no new dependencies.

**Research finding — no API for regeneration:** The `experimental.chat.system.transform` hook receives only `{ sessionID, model }` as input and `{ system: string[] }` as output. opencode does **not** expose any API to regenerate the dynamic sections (env, instructions, skills). The internal generators (`SystemPrompt.Service.environment`, `SystemPrompt.Service.skills`, `Instruction.Service.system`) are Effect service methods not available to plugins. The string-boundary approach is therefore the only viable strategy.

At hook time, `output.system` is `[singleString]` where that one string is the `\n`-joined concatenation of: provider base prompt (or agent custom prompt) → env block → instructions → skills listing → user system override. The boundaries between these sections are implicit in the string. The two markers used by `findDynamicBoundary` come from opencode's own source:

1. **Primary marker** (`DEFAULT_DYNAMIC_BOUNDARY`): `"\nYou are powered by the model named"` — first line of `SystemPrompt.environment()`, emitted for every model.
2. **Fallback marker** (`DEFAULT_FALLBACK_DYNAMIC_BOUNDARY`): `"\n<env>"` — the XML tag wrapping the environment detail block. Used if the primary marker is absent (e.g. opencode changes the env wording but keeps the XML structure).

If opencode ever changes both markers, `findDynamicBoundary` returns `-1` and the feature degrades gracefully to the full-splice fallback (same as `preserveDynamic: false`).

**Companion docs:**
- [`SPEC.md`](../../../SPEC.md) — runtime contract
- [`docs/superpowers/plans/2026-05-18-opencode-sysprompt-override.md`](./2026-05-18-opencode-sysprompt-override.md) — original implementation plan
- [`src/constants.ts`](../../src/constants.ts) — NEW — default boundary markers
- [`src/types.ts`](../../src/types.ts) — `Rule`/`ParsedRule`/`Config` need new fields
- [`src/config.ts`](../../src/config.ts) — parse new fields
- [`src/apply.ts`](../../src/apply.ts) — `findDynamicBoundary` + extended `applyRule`
- [`src/index.ts`](../../src/index.ts) — wire boundary markers through to `applyRule`

---

## Shared types reference

New constants file:
```ts
// src/constants.ts
export const DEFAULT_DYNAMIC_BOUNDARY = "\nYou are powered by the model named"
export const DEFAULT_FALLBACK_DYNAMIC_BOUNDARY = "\n<env>"
```

Field additions to existing interfaces:
```diff
 // In Config (top-level config shape)
 export interface Config {
   lenient?: boolean
+  dynamicBoundaryMarker?: string    // overrides DEFAULT_DYNAMIC_BOUNDARY
+  dynamicFallbackMarker?: string    // overrides DEFAULT_FALLBACK_DYNAMIC_BOUNDARY
   default?: Omit<Rule, "match">
   rules?: Rule[]
 }

 // In Rule (user-facing per-rule config shape)
 export interface Rule {
   match?: MatchSpec
   mode: Mode
   position?: Position
+  preserveDynamic?: boolean
   prompt?: string
   promptFile?: string
 }

 // In ParsedRule (internal parsed shape)
 export interface ParsedRule {
   raw: Rule
   index: number
   match: CompiledMatch
   mode: Mode
   position: Position
+  preserveDynamic: boolean
   prompt?: string
   promptFile?: string
 }
```

`preserveDynamic` on `ParsedRule` is non-optional `boolean` (defaults to `false` at parse time).

---

## Task 1: Create constants file

**Files:**
- Create: `src/constants.ts`

- [ ] **Step 1: Write `src/constants.ts`**

```ts
export const DEFAULT_DYNAMIC_BOUNDARY = '\nYou are powered by the model named'
export const DEFAULT_FALLBACK_DYNAMIC_BOUNDARY = '\n<env>'
```

- [ ] **Step 2: Commit**

```bash
git add src/constants.ts
git commit -m "Add constants for dynamic boundary markers"
```

---

## Task 2: Add fields to types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `dynamicBoundaryMarker?: string` and `dynamicFallbackMarker?: string` to `Config`.**

- [ ] **Step 2: Add `preserveDynamic?: boolean` to `Rule`** and `preserveDynamic: boolean` to `ParsedRule`.

---

## Task 3: Parse new fields in config loader

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Import constants:**
```ts
import { DEFAULT_DYNAMIC_BOUNDARY, DEFAULT_FALLBACK_DYNAMIC_BOUNDARY } from "./constants"
```

- [ ] **Step 2: Add `dynamicBoundaryMarker` and `dynamicFallbackMarker` to `LoadedConfig`:**
```ts
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
```

- [ ] **Step 3: After parsing `cfg`, resolve the markers — add the two new fields to the `loaded` object literal:**
```ts
const loaded: LoadedConfig = {
  path: found, dir, logPath, mtimeMs: st.mtimeMs,
  cfg, parsedRules, parsedDefault, errors, seen,
  dynamicBoundaryMarker: cfg.dynamicBoundaryMarker ?? DEFAULT_DYNAMIC_BOUNDARY,
  dynamicFallbackMarker: cfg.dynamicFallbackMarker ?? DEFAULT_FALLBACK_DYNAMIC_BOUNDARY,
}
```

- [ ] **Step 4: In `parseRule()`, after existing parsed fields, add:**
```ts
parsed.preserveDynamic = rule.preserveDynamic === true
```
No validation needed — any value that isn't `true` is `false`.

- [ ] **Step 5: Update config tests to assert defaults** — add a test that without the keys, `dynamicBoundaryMarker` equals `DEFAULT_DYNAMIC_BOUNDARY` and `dynamicFallbackMarker` equals `DEFAULT_FALLBACK_DYNAMIC_BOUNDARY`.

---

## Task 4: Add `findDynamicBoundary` helper and extend `applyRule`

**Files:**
- Modify: `src/apply.ts`
- Modify: `test/apply.test.ts`

- [ ] **Step 1: Import constants:**
```ts
import { DEFAULT_DYNAMIC_BOUNDARY, DEFAULT_FALLBACK_DYNAMIC_BOUNDARY } from "./constants"
```

- [ ] **Step 2: Add helper (new function at top of `src/apply.ts`):**

```ts
export function findDynamicBoundary(
  fullPrompt: string,
  marker: string = DEFAULT_DYNAMIC_BOUNDARY,
  fallbackMarker: string = DEFAULT_FALLBACK_DYNAMIC_BOUNDARY,
): number {
  const idx = fullPrompt.indexOf(marker)
  if (idx !== -1) return idx
  const fallbackIdx = fullPrompt.indexOf(fallbackMarker)
  if (fallbackIdx !== -1) {
    const nlIdx = fullPrompt.lastIndexOf('\n', fallbackIdx - 1)
    return nlIdx !== -1 ? nlIdx : fallbackIdx
  }
  return -1
}
```

- [ ] **Step 3: Modify `applyRule` to accept and pass through boundary markers:**

```ts
export function applyRule(
  rule: ParsedRule,
  text: string,
  output: { system: string[] },
  dynamicBoundaryMarker?: string,
  dynamicFallbackMarker?: string,
): void {
  if (rule.mode === "replace") {
    if (rule.preserveDynamic) {
      const fullPrompt = output.system[0] || ""
      const boundary = findDynamicBoundary(
        fullPrompt,
        dynamicBoundaryMarker,
        dynamicFallbackMarker,
      )
      if (boundary !== -1) {
        output.system[0] = text + fullPrompt.slice(boundary)
        return
      }
    }
    output.system.splice(0, output.system.length, text)
    return
  }
  if (rule.position === "start") {
    output.system.unshift(text)
    return
  }
  output.system.push(text)
}
```

- [ ] **Step 4: Add tests to `test/apply.test.ts`:**

Add test cases for:
- `preserveDynamic: true` with primary boundary present → only provider prompt replaced, dynamic sections kept
- `preserveDynamic: true` with only fallback boundary present → provider prompt replaced, dynamic sections kept
- `preserveDynamic: true` with custom marker passed → uses custom marker instead of default
- `preserveDynamic: true` with no boundary found → falls back to full replace
- `preserveDynamic: false` (or not set) → original full replace behavior unchanged

---

## Task 5: Wire boundary markers through plugin entry point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: In the `transform` function, pass markers to `applyRule`:**

```ts
for (const rule of matched) {
  let text: string
  try {
    text = resolvePromptText(rule, loaded.dir)
  } catch (err) {
    reportError(errCtx, "promptfile-error", String(err), { ruleIndex: rule.index })
    continue
  }
  applyRule(rule, text, output, loaded.dynamicBoundaryMarker, loaded.dynamicFallbackMarker)
  anyApplied = true
}
```

Same change for the default-rule branch.

---

## Task 6: Integration test

**Files:**
- Modify: `test/integration.test.ts`

- [ ] **Step 1: Add test cases:**

1. `mode: "replace", preserveDynamic: true` — `output.system[0]` contains env section starting with the default primary marker. Assert the replacement text appears at the start AND the env section is preserved at the end.

2. `mode: "replace", preserveDynamic: true` with `dynamicBoundaryMarker` set to a custom string — `output.system[0]` contains that custom marker instead of the default. Assert the replacement text appears at the start AND the custom-marker section is preserved.

---

## Task 7: Update JSON schema

**Files:**
- Modify: `schemas/system-prompts.schema.json`

- [ ] **Step 1: Add `preserveDynamic` to the `RuleBody` and `Rule` definitions:**

In `RuleBody`:
```json
"preserveDynamic": {
  "type": "boolean",
  "default": false,
  "description": "When true and mode is replace, keeps runtime-generated sections (env, instructions, skills) intact"
}
```

And also in `Rule` (since `Rule` duplicates `RuleBody`'s properties rather than using `allOf`).

- [ ] **Step 2: Add top-level config fields:**

```json
"dynamicBoundaryMarker": {
  "type": "string",
  "default": "\\nYou are powered by the model named",
  "description": "Overrides the string used to locate the start of runtime-generated dynamic sections. Default is opencode's env-section header."
},
"dynamicFallbackMarker": {
  "type": "string",
  "default": "\\n<env>",
  "description": "Fallback string used if the primary marker is not found. Default is opencode's <env> XML tag."
}
```

---

## Task 8: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Caveats section item about `mode: "replace"`** to mention `preserveDynamic` as the way to keep the runtime sections.

- [ ] **Step 2: Add `preserveDynamic` example** to the config schema block.

- [ ] **Step 3: Add documentation for `dynamicBoundaryMarker` and `dynamicFallbackMarker`** in the "Fields" section under "Root".

- [ ] **Step 4: Add a note about the fragility of string-based boundaries** and the graceful fallback when `findDynamicBoundary` returns `-1`.

---

## Self-review checklist (do not skip)

Before handing the plan to a worker, the plan author confirms:

- [ ] Every shared type used in tasks is defined in Tasks 1-2.
- [ ] Every test file referenced in a task exists in the file structure.
- [ ] No "TBD" / "TODO" / "fill in" markers in any step.
- [ ] Every step that changes code includes the code block.
- [ ] Function signatures match across tasks (`findDynamicBoundary`, `applyRule`, `parseRule`, `loadConfigIfChanged` use the same arguments everywhere).
- [ ] Spec coverage:
  - `src/constants.ts` with both markers as named exports (Task 1)
  - `dynamicBoundaryMarker` and `dynamicFallbackMarker` on `Config` (top-level, optional) (Task 2)
  - `preserveDynamic` is **optional** on `Rule` (backwards-compatible with every existing config) (Task 2)
  - `preserveDynamic` is non-optional `boolean` on `ParsedRule`, defaulting to `false` (Task 2)
  - Parsing: `rule.preserveDynamic === true` — only literal `true` enables it (Task 3)
  - `LoadedConfig` resolves markers: override from config or fall back to constants (Task 3)
  - `findDynamicBoundary` accepts both markers as optional parameters (defaulting to constants) (Task 4)
  - Primary marker tried first; fallback marker tried second; `-1` if neither found → full replace (Task 4)
  - `preserveDynamic: false` (and absent) → original `splice`-replace behavior, bit-identical to before (Task 4)
  - Boundary markers threaded from `LoadedConfig` through `applyRule` in plugin entry point (Task 5)
  - Integration tests cover default markers and custom overrides (Task 6)
  - JSON schema validates both new top-level fields and per-rule `preserveDynamic` (Task 7)
  - README documents both fields, the caveat, and the graceful degradation (Task 8)
