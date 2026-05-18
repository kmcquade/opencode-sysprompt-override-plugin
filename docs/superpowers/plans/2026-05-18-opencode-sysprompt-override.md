# opencode-sysprompt-override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an npm-publishable opencode plugin that overrides or extends the per-model system prompt from a JSON config, with fail-loud error handling by default.

**Architecture:** Bun-native TypeScript package, zero runtime dependencies, bundled to a single ESM file plus `.d.ts` for npm distribution. Plugin entry returns one hook (`experimental.chat.system.transform`) that loads a config file, matches rules against the runtime `Provider.Model` (exact + glob on `providerID` and `id`), and mutates `output.system` in place. Errors inject a visible `<SYSTEM POLICY ERROR>` block into the system prompt by default; `"lenient": true` switches to silent warn-and-skip. Every error is appended to `<config-dir>/system-prompt-override.log` regardless.

**Tech Stack:** TypeScript 5.x, Bun 1.x (runtime + test + build), `@opencode-ai/plugin` (peerDep, also devDep for types), `@types/bun`.

**Companion docs:**
- [`SPEC.md`](../../../SPEC.md) — verified runtime contract (hook shape, source citations)
- [`docs/superpowers/specs/2026-05-18-plugin-build-design.md`](../specs/2026-05-18-plugin-build-design.md) — the build design this plan implements

---

## Shared types reference

These types live in `src/types.ts` (created in Task 1) and are referenced throughout the plan:

```ts
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
```

---

## Task 0: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `Makefile`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`

- [ ] **Step 1: Add Node/Bun artifacts to .gitignore**

Append to the existing `.gitignore`:

```
# Node / Bun
node_modules/
dist/
*.tsbuildinfo
.bun/

# Local logs
system-prompt-override.log
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "opencode-sysprompt-override",
  "version": "0.1.0",
  "description": "Override or extend opencode's per-model system prompt from a JSON config file",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "schemas",
    "examples",
    "SPEC.md",
    "README.md"
  ],
  "scripts": {
    "test": "bun test",
    "build": "bun build src/index.ts --target=bun --outdir=dist --format=esm && bun x tsc --emitDeclarationOnly --outDir dist",
    "prepublishOnly": "make ci"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": "*"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "*",
    "@types/bun": "latest",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 4: Create `bunfig.toml`**

```toml
[test]
preload = []
```

(Minimal — the file exists so future test config has a home.)

- [ ] **Step 5: Create `Makefile`**

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

- [ ] **Step 6: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      - run: make ci
```

- [ ] **Step 7: Install dependencies**

Run: `bun install`
Expected: `node_modules/` created; lock file written; no errors.

- [ ] **Step 8: Commit**

```bash
git add .gitignore package.json tsconfig.json bunfig.toml Makefile .github/workflows/ci.yml bun.lockb
git commit -m "Scaffold project: package.json, tsconfig, Makefile, CI"
```

(If `bun install` produced `bun.lock` instead of `bun.lockb`, stage whichever exists.)

---

## Task 1: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`** (full content shown in "Shared types reference" at the top of this plan)

Copy the entire block under "Shared types reference" into `src/types.ts`.

- [ ] **Step 2: Verify it compiles**

Run: `bun x tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "Add shared types"
```

---

## Task 2: Glob → RegExp

**Files:**
- Create: `src/glob.ts`
- Create: `test/glob.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/glob.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { globToRegex } from "../src/glob"

describe("globToRegex", () => {
  it("matches `*` to any sequence of characters", () => {
    const r = globToRegex("qwen*")
    expect(r.test("qwen3-coder")).toBe(true)
    expect(r.test("qwen-plus")).toBe(true)
    expect(r.test("qwen")).toBe(true)
    expect(r.test("claude-qwen")).toBe(false)
  })

  it("matches `?` to exactly one character", () => {
    const r = globToRegex("qwen?")
    expect(r.test("qwen3")).toBe(true)
    expect(r.test("qwen")).toBe(false)
    expect(r.test("qwen33")).toBe(false)
  })

  it("escapes regex metacharacters in literal portions", () => {
    const r = globToRegex("claude-3.5")
    expect(r.test("claude-3.5")).toBe(true)
    expect(r.test("claude-3X5")).toBe(false)
  })

  it("anchors at both ends", () => {
    const r = globToRegex("foo")
    expect(r.test("foo")).toBe(true)
    expect(r.test("foobar")).toBe(false)
    expect(r.test("barfoo")).toBe(false)
  })

  it("handles empty pattern as exact-match-empty", () => {
    const r = globToRegex("")
    expect(r.test("")).toBe(true)
    expect(r.test("x")).toBe(false)
  })

  it("combines `*` and `?`", () => {
    const r = globToRegex("a?c*")
    expect(r.test("abc")).toBe(true)
    expect(r.test("abcde")).toBe(true)
    expect(r.test("ac")).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun test test/glob.test.ts`
Expected: failure — `Cannot find module '../src/glob'`.

- [ ] **Step 3: Implement `src/glob.ts`**

```ts
const REGEX_META = /[.+^${}()|[\]\\]/g

export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(REGEX_META, "\\$&")
  const regex = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  return new RegExp(regex)
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun test test/glob.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/glob.ts test/glob.test.ts
git commit -m "Add glob-to-regex converter"
```

---

## Task 3: Log file writer

**Files:**
- Create: `src/log.ts`
- Create: `test/log.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/log.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { writeLog } from "../src/log"

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "log-test-"))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe("writeLog", () => {
  it("appends a JSON line to the log file", () => {
    const logPath = join(tmp, "log.jsonl")
    writeLog(logPath, {
      timestamp: "2026-05-18T00:00:00.000Z",
      code: "test-code",
      message: "test message",
    })
    const content = readFileSync(logPath, "utf8")
    expect(content.endsWith("\n")).toBe(true)
    const parsed = JSON.parse(content.trim())
    expect(parsed.code).toBe("test-code")
    expect(parsed.message).toBe("test message")
  })

  it("creates parent directories if missing", () => {
    const logPath = join(tmp, "nested", "deep", "log.jsonl")
    writeLog(logPath, {
      timestamp: "2026-05-18T00:00:00.000Z",
      code: "x",
      message: "y",
    })
    expect(existsSync(logPath)).toBe(true)
  })

  it("appends multiple entries", () => {
    const logPath = join(tmp, "log.jsonl")
    writeLog(logPath, { timestamp: "t1", code: "a", message: "1" })
    writeLog(logPath, { timestamp: "t2", code: "b", message: "2" })
    const lines = readFileSync(logPath, "utf8").trim().split("\n")
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!).code).toBe("a")
    expect(JSON.parse(lines[1]!).code).toBe("b")
  })

  it("does not throw when log path is unwritable", () => {
    // Use a path that points through a file, which can't be a parent directory.
    const blocker = join(tmp, "blocker")
    require("node:fs").writeFileSync(blocker, "x")
    const bad = join(blocker, "log.jsonl")
    expect(() => writeLog(bad, { timestamp: "t", code: "c", message: "m" })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun test test/log.test.ts`
Expected: failure — module not found.

- [ ] **Step 3: Implement `src/log.ts`**

```ts
import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { ErrorEvent } from "./types"

export function writeLog(logPath: string, event: ErrorEvent): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, JSON.stringify(event) + "\n", "utf8")
  } catch {
    // Log writes must never throw — silent failure is correct here.
  }
}
```

- [ ] **Step 4: Run to confirm tests pass**

Run: `bun test test/log.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/log.ts test/log.test.ts
git commit -m "Add append-only JSON-lines log writer"
```

---

## Task 4: Error reporting (fail-loud + lenient)

**Files:**
- Create: `src/errors.ts`
- Create: `test/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/errors.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { reportError, type ErrorContext } from "../src/errors"

let tmp: string
let logPath: string
let output: { system: string[] }

function makeCtx(lenient: boolean): ErrorContext {
  return {
    logPath,
    lenient,
    configPath: "/fake/config.json",
    output,
    seen: new Set(),
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "errors-test-"))
  logPath = join(tmp, "log.jsonl")
  output = { system: ["original"] }
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe("reportError fail-loud (default)", () => {
  it("prepends a SYSTEM POLICY ERROR block to output.system", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad-thing", "something went wrong")
    expect(output.system.length).toBe(2)
    expect(output.system[0]).toContain("<SYSTEM POLICY ERROR: bad-thing: something went wrong>")
    expect(output.system[1]).toBe("original")
  })

  it("writes a JSON line to the log file", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad-thing", "msg", { ruleIndex: 2 })
    expect(existsSync(logPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(logPath, "utf8").trim())
    expect(parsed.code).toBe("bad-thing")
    expect(parsed.ruleIndex).toBe(2)
  })

  it("injects the block on every call (fail-loud is persistent)", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad", "m")
    reportError(ctx, "bad", "m")
    const blocks = output.system.filter((s) => s.startsWith("<SYSTEM POLICY ERROR"))
    expect(blocks.length).toBe(2)
  })

  it("writes only one log line per unique (code,path,ruleIndex)", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad", "m", { ruleIndex: 1 })
    reportError(ctx, "bad", "m", { ruleIndex: 1 })
    const lines = readFileSync(logPath, "utf8").trim().split("\n")
    expect(lines.length).toBe(1)
  })

  it("treats different ruleIndex as different events", () => {
    const ctx = makeCtx(false)
    reportError(ctx, "bad", "m", { ruleIndex: 1 })
    reportError(ctx, "bad", "m", { ruleIndex: 2 })
    const lines = readFileSync(logPath, "utf8").trim().split("\n")
    expect(lines.length).toBe(2)
  })
})

describe("reportError lenient", () => {
  it("does NOT inject into output.system", () => {
    const ctx = makeCtx(true)
    reportError(ctx, "bad", "m")
    expect(output.system).toEqual(["original"])
  })

  it("still writes to the log file", () => {
    const ctx = makeCtx(true)
    reportError(ctx, "bad", "m")
    expect(existsSync(logPath)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun test test/errors.test.ts`
Expected: failure — module not found.

- [ ] **Step 3: Implement `src/errors.ts`**

```ts
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
```

- [ ] **Step 4: Run to confirm tests pass**

Run: `bun test test/errors.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts test/errors.test.ts
git commit -m "Add reportError with fail-loud and lenient modes"
```

---

## Task 5: Rule matching

**Files:**
- Create: `src/match.ts`
- Create: `test/match.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/match.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { compileMatch, matches } from "../src/match"
import type { ParsedRule, ModelLike } from "../src/types"

function makeRule(matchSpec: Parameters<typeof compileMatch>[0]): ParsedRule {
  return {
    raw: { mode: "append" },
    index: 0,
    match: compileMatch(matchSpec),
    mode: "append",
    position: "end",
  }
}

const qwen: ModelLike = { providerID: "openrouter", id: "qwen3-coder" }
const claude: ModelLike = { providerID: "anthropic", id: "claude-sonnet-4-6" }

describe("matches", () => {
  it("empty match matches every model", () => {
    expect(matches(makeRule(undefined), qwen)).toBe(true)
    expect(matches(makeRule({}), claude)).toBe(true)
  })

  it("exact providerID matches", () => {
    const r = makeRule({ providerID: "anthropic" })
    expect(matches(r, claude)).toBe(true)
    expect(matches(r, qwen)).toBe(false)
  })

  it("exact modelID matches model.id (not modelID)", () => {
    const r = makeRule({ modelID: "qwen3-coder" })
    expect(matches(r, qwen)).toBe(true)
    expect(matches(r, claude)).toBe(false)
  })

  it("providerIDGlob matches via glob", () => {
    const r = makeRule({ providerIDGlob: "open*" })
    expect(matches(r, qwen)).toBe(true)
    expect(matches(r, claude)).toBe(false)
  })

  it("modelIDGlob matches via glob", () => {
    const r = makeRule({ modelIDGlob: "qwen*" })
    expect(matches(r, qwen)).toBe(true)
    expect(matches(r, claude)).toBe(false)
  })

  it("multiple fields AND together", () => {
    const r = makeRule({ providerID: "openrouter", modelIDGlob: "qwen*" })
    expect(matches(r, qwen)).toBe(true)
    expect(matches(r, { providerID: "openrouter", id: "claude-3" })).toBe(false)
    expect(matches(r, { providerID: "other", id: "qwen3-coder" })).toBe(false)
  })

  it("exact and glob on the same field both must match if both set", () => {
    const r = makeRule({ providerID: "openrouter", providerIDGlob: "open*" })
    expect(matches(r, qwen)).toBe(true)
    const r2 = makeRule({ providerID: "openrouter", providerIDGlob: "anthropic*" })
    expect(matches(r2, qwen)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun test test/match.test.ts`
Expected: failure — module not found.

- [ ] **Step 3: Implement `src/match.ts`**

```ts
import type { ModelLike, ParsedRule, MatchSpec, CompiledMatch } from "./types"
import { globToRegex } from "./glob"

export function compileMatch(spec: MatchSpec | undefined): CompiledMatch {
  if (!spec) return {}
  const out: CompiledMatch = {}
  if (spec.providerID !== undefined) out.providerID = spec.providerID
  if (spec.modelID !== undefined) out.modelID = spec.modelID
  if (spec.providerIDGlob !== undefined) out.providerIDRegex = globToRegex(spec.providerIDGlob)
  if (spec.modelIDGlob !== undefined) out.modelIDRegex = globToRegex(spec.modelIDGlob)
  return out
}

export function matches(rule: ParsedRule, model: ModelLike): boolean {
  const m = rule.match
  if (m.providerID !== undefined && m.providerID !== model.providerID) return false
  if (m.providerIDRegex !== undefined && !m.providerIDRegex.test(model.providerID)) return false
  if (m.modelID !== undefined && m.modelID !== model.id) return false
  if (m.modelIDRegex !== undefined && !m.modelIDRegex.test(model.id)) return false
  return true
}
```

- [ ] **Step 4: Run to confirm tests pass**

Run: `bun test test/match.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/match.ts test/match.test.ts
git commit -m "Add rule matching with exact + glob, AND-semantics"
```

---

## Task 6: Apply rule (mutation)

**Files:**
- Create: `src/apply.ts`
- Create: `test/apply.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/apply.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { applyRule } from "../src/apply"
import type { ParsedRule } from "../src/types"

function rule(opts: Partial<ParsedRule> & Pick<ParsedRule, "mode" | "position">): ParsedRule {
  return {
    raw: { mode: opts.mode },
    index: 0,
    match: {},
    prompt: "x",
    ...opts,
  } as ParsedRule
}

describe("applyRule", () => {
  it("append/end pushes to the end", () => {
    const out = { system: ["base"] }
    applyRule(rule({ mode: "append", position: "end" }), "added", out)
    expect(out.system).toEqual(["base", "added"])
  })

  it("append/start unshifts to the start", () => {
    const out = { system: ["base"] }
    applyRule(rule({ mode: "append", position: "start" }), "added", out)
    expect(out.system).toEqual(["added", "base"])
  })

  it("replace clears the array and inserts", () => {
    const out = { system: ["a", "b", "c"] }
    applyRule(rule({ mode: "replace", position: "end" }), "fresh", out)
    expect(out.system).toEqual(["fresh"])
  })

  it("multiple rules stack in order", () => {
    const out = { system: ["base"] }
    applyRule(rule({ mode: "append", position: "end" }), "1", out)
    applyRule(rule({ mode: "append", position: "end" }), "2", out)
    expect(out.system).toEqual(["base", "1", "2"])
  })

  it("replace after append wipes the appended content", () => {
    const out = { system: ["base"] }
    applyRule(rule({ mode: "append", position: "end" }), "added", out)
    applyRule(rule({ mode: "replace", position: "end" }), "fresh", out)
    expect(out.system).toEqual(["fresh"])
  })

  it("append after replace preserves the replacement plus the append", () => {
    const out = { system: ["base"] }
    applyRule(rule({ mode: "replace", position: "end" }), "fresh", out)
    applyRule(rule({ mode: "append", position: "end" }), "extra", out)
    expect(out.system).toEqual(["fresh", "extra"])
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun test test/apply.test.ts`
Expected: failure — module not found.

- [ ] **Step 3: Implement `src/apply.ts`**

```ts
import type { ParsedRule } from "./types"

export function applyRule(
  rule: ParsedRule,
  text: string,
  output: { system: string[] },
): void {
  if (rule.mode === "replace") {
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

- [ ] **Step 4: Run to confirm tests pass**

Run: `bun test test/apply.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/apply.ts test/apply.test.ts
git commit -m "Add applyRule for append/replace mutation"
```

---

## Task 7: Config loader

**Files:**
- Create: `src/config.ts`
- Create: `test/config.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, statSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadConfigIfChanged, resolvePromptText, clearCache } from "../src/config"

let tmp: string
let opencodeDir: string
let configPath: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "config-test-"))
  opencodeDir = join(tmp, ".opencode")
  mkdirSync(opencodeDir, { recursive: true })
  configPath = join(opencodeDir, "system-prompts.json")
  clearCache()
  delete process.env.OPENCODE_SYSTEM_PROMPT_CONFIG
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  clearCache()
  delete process.env.OPENCODE_SYSTEM_PROMPT_CONFIG
})

describe("loadConfigIfChanged", () => {
  it("returns null when no config file exists", () => {
    expect(loadConfigIfChanged(tmp)).toBeNull()
  })

  it("loads a valid config", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ match: { modelID: "qwen3-coder" }, mode: "replace", prompt: "p" }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded).not.toBeNull()
    expect(loaded!.parsedRules.length).toBe(1)
    expect(loaded!.parsedRules[0]!.mode).toBe("replace")
    expect(loaded!.errors.length).toBe(0)
  })

  it("returns the cached config when mtime is unchanged", () => {
    writeFileSync(configPath, JSON.stringify({ rules: [] }))
    const first = loadConfigIfChanged(tmp)
    const second = loadConfigIfChanged(tmp)
    expect(second).toBe(first) // same reference
  })

  it("re-reads when mtime changes", () => {
    writeFileSync(configPath, JSON.stringify({ rules: [] }))
    const first = loadConfigIfChanged(tmp)
    // Bump mtime forward
    const future = new Date(Date.now() + 5000)
    utimesSync(configPath, future, future)
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", prompt: "x" }],
    }))
    const second = loadConfigIfChanged(tmp)
    expect(second).not.toBe(first)
    expect(second!.parsedRules.length).toBe(1)
  })

  it("captures malformed JSON as a config-malformed error", () => {
    writeFileSync(configPath, "{ not valid json")
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded).not.toBeNull()
    expect(loaded!.errors[0]!.code).toBe("config-malformed")
    expect(loaded!.parsedRules.length).toBe(0)
  })

  it("captures rule-invalid for rule with both prompt and promptFile", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", prompt: "x", promptFile: "y" }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.errors.length).toBe(1)
    expect(loaded!.errors[0]!.code).toBe("rule-invalid")
    expect(loaded!.errors[0]!.ruleIndex).toBe(0)
  })

  it("captures rule-invalid for unknown mode", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "blast", prompt: "x" }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.errors[0]!.code).toBe("rule-invalid")
  })

  it("parses default rule when present", () => {
    writeFileSync(configPath, JSON.stringify({
      default: { mode: "append", prompt: "fallback" },
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.parsedDefault).not.toBeNull()
    expect(loaded!.parsedDefault!.prompt).toBe("fallback")
  })

  it("parses inline prompts containing // and https:// safely", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{
        mode: "replace",
        prompt: "Visit https://example.com or use // for comments in code. /* like this */",
      }],
    }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.errors.length).toBe(0)
    expect(loaded!.parsedRules[0]!.prompt).toContain("https://example.com")
  })

  it("respects OPENCODE_SYSTEM_PROMPT_CONFIG env var", () => {
    const altPath = join(tmp, "alt-config.json")
    writeFileSync(altPath, JSON.stringify({ rules: [{ mode: "append", prompt: "alt" }] }))
    process.env.OPENCODE_SYSTEM_PROMPT_CONFIG = altPath
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.path).toBe(altPath)
    expect(loaded!.parsedRules[0]!.prompt).toBe("alt")
  })

  it("computes logPath relative to the config directory", () => {
    writeFileSync(configPath, JSON.stringify({ rules: [] }))
    const loaded = loadConfigIfChanged(tmp)
    expect(loaded!.logPath).toBe(join(opencodeDir, "system-prompt-override.log"))
  })
})

describe("resolvePromptText", () => {
  it("returns inline prompt", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", prompt: "hello" }],
    }))
    const loaded = loadConfigIfChanged(tmp)!
    expect(resolvePromptText(loaded.parsedRules[0]!, loaded.dir)).toBe("hello")
  })

  it("reads promptFile relative to config dir", () => {
    const promptPath = join(opencodeDir, "p.md")
    writeFileSync(promptPath, "from file")
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", promptFile: "./p.md" }],
    }))
    const loaded = loadConfigIfChanged(tmp)!
    expect(resolvePromptText(loaded.parsedRules[0]!, loaded.dir)).toBe("from file")
  })

  it("throws when promptFile is missing", () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [{ mode: "append", promptFile: "./nope.md" }],
    }))
    const loaded = loadConfigIfChanged(tmp)!
    expect(() => resolvePromptText(loaded.parsedRules[0]!, loaded.dir)).toThrow()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun test test/config.test.ts`
Expected: failure — module not found.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { existsSync, statSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { homedir } from "node:os"
import type { Config, ParsedRule, Rule } from "./types"
import { compileMatch } from "./match"

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
  }
  cached = loaded
  return loaded
}

function parseRule(rule: Rule, index: number): ParsedRule {
  if (rule.mode !== "append" && rule.mode !== "replace") {
    throw new Error(`unknown mode: ${String((rule as { mode: unknown }).mode)}`)
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
```

- [ ] **Step 4: Run to confirm tests pass**

Run: `bun test test/config.test.ts`
Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "Add config loader: discovery, JSON.parse, mtime cache, rule parsing"
```

---

## Task 8: Plugin factory (wiring)

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement `src/index.ts`**

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `bun x tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify all unit tests still pass**

Run: `bun test`
Expected: all tests across all modules pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "Wire plugin factory: load, match, apply, report"
```

---

## Task 9: Integration test

**Files:**
- Create: `test/integration.test.ts`

- [ ] **Step 1: Write the integration tests**

`test/integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { clearCache } from "../src/config"
import plugin from "../src/index"

let tmp: string
let opencodeDir: string
let configPath: string
let logPath: string

const qwen = {
  providerID: "openrouter",
  id: "qwen3-coder",
  api: { id: "qwen3-coder", url: "", npm: "" },
  name: "Qwen3 Coder",
  capabilities: {},
}

const claude = {
  providerID: "anthropic",
  id: "claude-sonnet-4-6",
  api: { id: "claude-sonnet-4-6", url: "", npm: "" },
  name: "Claude",
  capabilities: {},
}

function fakeCtx(directory: string) {
  return {
    client: {} as unknown,
    project: {} as unknown,
    directory,
    worktree: directory,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost"),
    $: {} as unknown,
  } as any
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "integration-test-"))
  opencodeDir = join(tmp, ".opencode")
  mkdirSync(opencodeDir, { recursive: true })
  configPath = join(opencodeDir, "system-prompts.json")
  logPath = join(opencodeDir, "system-prompt-override.log")
  clearCache()
  delete process.env.OPENCODE_SYSTEM_PROMPT_CONFIG
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  clearCache()
})

describe("plugin end-to-end", () => {
  it("happy path: explicit qwen rule applies, default skipped", async () => {
    writeFileSync(configPath, JSON.stringify({
      default: { mode: "append", prompt: "DEFAULT" },
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", prompt: "QWEN-OVERRIDE" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system).toEqual(["QWEN-OVERRIDE"])
  })

  it("default fires when no explicit rule matched", async () => {
    writeFileSync(configPath, JSON.stringify({
      default: { mode: "append", prompt: "DEFAULT" },
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", prompt: "QWEN" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: claude } as any,
      output,
    )
    expect(output.system).toEqual(["original", "DEFAULT"])
  })

  it("replace then append: both apply in declared order", async () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", prompt: "REPLACED" },
        { match: {}, mode: "append", prompt: "APPENDED" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system).toEqual(["REPLACED", "APPENDED"])
  })

  it("fail-loud: missing promptFile injects error block and writes log", async () => {
    writeFileSync(configPath, JSON.stringify({
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", promptFile: "./missing.md" },
        { match: {}, mode: "append", prompt: "VALID" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system[0]).toContain("<SYSTEM POLICY ERROR")
    expect(output.system).toContain("VALID")
    expect(existsSync(logPath)).toBe(true)
    const entry = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n")[0]!)
    expect(entry.code).toBe("promptfile-error")
    expect(entry.ruleIndex).toBe(0)
  })

  it("lenient: missing promptFile skips silently but still logs", async () => {
    writeFileSync(configPath, JSON.stringify({
      lenient: true,
      rules: [
        { match: { modelIDGlob: "qwen*" }, mode: "replace", promptFile: "./missing.md" },
        { match: {}, mode: "append", prompt: "VALID" },
      ],
    }))
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system.some((s) => s.startsWith("<SYSTEM POLICY ERROR"))).toBe(false)
    expect(output.system).toContain("VALID")
    expect(existsSync(logPath)).toBe(true)
  })

  it("malformed JSON: fail-loud injects error block, no rules applied", async () => {
    writeFileSync(configPath, "{ not valid json")
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system[0]).toContain("<SYSTEM POLICY ERROR")
    expect(output.system[0]).toContain("config-malformed")
    // original is preserved at position 1
    expect(output.system).toContain("original")
  })

  it("no config file: silent no-op", async () => {
    const hooks = await plugin(fakeCtx(tmp))
    const output = { system: ["original"] }
    await hooks["experimental.chat.system.transform"]!(
      { model: qwen } as any,
      output,
    )
    expect(output.system).toEqual(["original"])
  })
})
```

- [ ] **Step 2: Run the integration tests**

Run: `bun test test/integration.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: every unit and integration test passes.

- [ ] **Step 4: Commit**

```bash
git add test/integration.test.ts
git commit -m "Add end-to-end integration tests"
```

---

## Task 10: JSON schema for the config file

**Files:**
- Create: `schemas/system-prompts.schema.json`

- [ ] **Step 1: Write the schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "opencode-sysprompt-override config",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "lenient": {
      "type": "boolean",
      "default": false,
      "description": "If true, errors warn-and-skip silently instead of injecting a visible policy-error block into the system prompt. Logs are always written."
    },
    "default": {
      "$ref": "#/definitions/RuleBody",
      "description": "Rule applied when no explicit rule matched. No `match` field."
    },
    "rules": {
      "type": "array",
      "items": { "$ref": "#/definitions/Rule" }
    }
  },
  "definitions": {
    "MatchSpec": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "providerID": { "type": "string" },
        "providerIDGlob": { "type": "string" },
        "modelID": { "type": "string" },
        "modelIDGlob": { "type": "string" }
      }
    },
    "RuleBody": {
      "type": "object",
      "additionalProperties": false,
      "required": ["mode"],
      "properties": {
        "mode": { "type": "string", "enum": ["append", "replace"] },
        "position": { "type": "string", "enum": ["start", "end"], "default": "end" },
        "prompt": { "type": "string" },
        "promptFile": { "type": "string" }
      },
      "oneOf": [
        { "required": ["prompt"], "not": { "required": ["promptFile"] } },
        { "required": ["promptFile"], "not": { "required": ["prompt"] } }
      ]
    },
    "Rule": {
      "allOf": [
        { "$ref": "#/definitions/RuleBody" },
        {
          "type": "object",
          "properties": {
            "match": { "$ref": "#/definitions/MatchSpec" }
          }
        }
      ]
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add schemas/system-prompts.schema.json
git commit -m "Add JSON schema for system-prompts config"
```

---

## Task 11: Example config

**Files:**
- Create: `examples/system-prompts.example.json`

- [ ] **Step 1: Write the example**

```json
{
  "$schema": "../schemas/system-prompts.schema.json",
  "lenient": false,
  "default": {
    "mode": "append",
    "prompt": "Be concise. No preamble."
  },
  "rules": [
    {
      "match": { "modelIDGlob": "qwen*" },
      "mode": "replace",
      "prompt": "You are a terse code assistant. Prefer tool calls over prose. Ask before destructive operations."
    },
    {
      "match": { "providerID": "anthropic", "modelID": "claude-sonnet-4-6" },
      "mode": "append",
      "position": "end",
      "prompt": "You are operating in a BeyondTrust security context. Follow least-privilege."
    },
    {
      "match": { "providerIDGlob": "openai*" },
      "mode": "append",
      "promptFile": "./prompts/openai-policy.md"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add examples/system-prompts.example.json
git commit -m "Add annotated example config"
```

---

## Task 12: README

**Files:**
- Modify: `README.md` (the current file describes the project; replace its contents with full install/usage docs)

- [ ] **Step 1: Replace `README.md` with the published-package README**

Overwrite `README.md` with:

````markdown
# opencode-sysprompt-override

An [opencode](https://github.com/anomalyco/opencode) plugin that overrides or extends the per-model system prompt from a JSON config file.

## Why

opencode ships a different base system prompt for each model family — `anthropic.txt`, `gpt.txt`, `gemini.txt`, `kimi.txt`, `trinity.txt`, and a catch-all `default.txt`. Selection is a substring match on `model.api.id` in opencode's source. There's no built-in way to override these per-model or layer custom instructions on top. This plugin fills the gap.

Use cases:

- Tell a specific model "you're operating in a security-sensitive context, follow least-privilege"
- Replace the default qwen / deepseek / llama prompt with something tighter
- Layer a global "be concise, no preamble" overlay on every model
- Customize the prompt for a model opencode doesn't have a baked-in prompt for

## Install

### Option A: npm

```bash
npm install opencode-sysprompt-override
```

Then in your `opencode.json`:

```json
{
  "plugin": ["opencode-sysprompt-override"]
}
```

### Option B: drop-in file

Copy `dist/index.js` from the package into your `.opencode/plugin/` directory. opencode auto-discovers `.opencode/plugin/*.{ts,js}` and loads them.

## Config

The plugin looks for a config file at these locations, in order:

1. `$OPENCODE_SYSTEM_PROMPT_CONFIG` (env var, absolute path)
2. `<project>/.opencode/system-prompts.json`
3. `~/.config/opencode/system-prompts.json`
4. `~/.opencode/system-prompts.json`

The config is **strict JSON** — no comments, no trailing commas. (See "Error model" below for why.)

### Schema

```json
{
  "$schema": "./node_modules/opencode-sysprompt-override/schemas/system-prompts.schema.json",
  "lenient": false,
  "default": {
    "mode": "append",
    "prompt": "Be concise."
  },
  "rules": [
    {
      "match": { "modelIDGlob": "qwen*" },
      "mode": "replace",
      "prompt": "You are a terse code assistant."
    },
    {
      "match": { "providerID": "anthropic" },
      "mode": "append",
      "position": "end",
      "promptFile": "./prompts/anthropic-overlay.md"
    }
  ]
}
```

### Fields

**Root:**
- `lenient` (boolean, default `false`) — see "Error model"
- `default` — rule applied when no explicit rule matched (no `match` field)
- `rules` — ordered list of rules

**`match`** (all fields optional, AND-semantics):
- `providerID` — exact match on `model.providerID`
- `providerIDGlob` — glob (`*`, `?`) on `model.providerID`
- `modelID` — exact match on `model.id`
- `modelIDGlob` — glob on `model.id`

A rule with no `match` (or empty `{}`) applies to every model.

**Rule body:**
- `mode` — `"append"` adds to the existing system prompt; `"replace"` wipes opencode's base prompt and substitutes yours
- `position` — `"end"` (default) or `"start"`. Only meaningful for `append`.
- Exactly one of:
  - `prompt` — inline string
  - `promptFile` — path to a file (relative to the config's directory, or absolute)

### Precedence

1. All matching rules in `rules` apply, in declared order.
2. If no explicit rule matched, `default` applies (if present).
3. `replace` clears `output.system` before writing its prompt; later rules apply on top.

## Error model

The plugin's job is to enforce custom system instructions, so silent failure is the wrong default. By default it is **fail-loud**: any config or rule error injects a visible `<SYSTEM POLICY ERROR: ...>` block at the front of the system prompt, and appends a JSON line to `<config-dir>/system-prompt-override.log`.

```
<SYSTEM POLICY ERROR: promptfile-error: ENOENT: ./prompts/missing.md>
The opencode-sysprompt-override plugin failed to apply this rule. See /path/to/system-prompt-override.log for details.
```

Setting `"lenient": true` in the config root switches to warn-and-skip — no injected blocks, just a `console.warn` and the log line. Use lenient during config development if the visible blocks are noisy.

The log file is append-only. Rotation is the user's responsibility.

## Caveats

1. The hook is `experimental.chat.system.transform`. opencode may rename it without a major-version bump. Pin your opencode version if this matters.
2. `mode: "replace"` discards opencode's per-model base prompt — those include tool-use instructions the agent relies on. Prefer `append` unless you genuinely want to take over fully.
3. `append` with `position: "end"` (the default) preserves opencode's 2-part prompt-cache header. `position: "start"` and `mode: "replace"` modify `system[0]`, which skips opencode's rejoin and changes cache shape.
4. The hook fires on every LLM call — chat turns, agent sub-runs, HTTP server requests alike.

## Development

```bash
make install    # bun install
make test       # bun test
make build      # bun build + tsc --emitDeclarationOnly
make ci         # install + test + build (same target CI runs)
```

CI is local-CI-parity: the GH Actions workflow runs `make ci` and nothing else. To reproduce a CI failure locally, run `make ci`.

## License

MIT
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Replace README with full install and usage docs"
```

---

## Task 13: Final CI verification

**Files:** none

- [ ] **Step 1: Run the full CI target locally**

Run: `make ci`
Expected: install + all tests pass + build produces `dist/index.js` and `dist/index.d.ts`.

- [ ] **Step 2: Inspect the built output**

Run: `ls -la dist/`
Expected: `index.js` (single-file ESM bundle) and `index.d.ts`.

Run: `bun run dist/index.js`
Expected: no output, no errors (the bundle exports a Plugin factory; running it has no top-level effects).

- [ ] **Step 3: Push to origin and verify CI**

Run: `git push`
Then check GitHub Actions for the `ci` workflow on the latest commit. Expected: green.

- [ ] **Step 4: Tag v0.1.0 (optional — only after manual verification of the README and example with a real opencode install)**

```bash
git tag v0.1.0
git push --tags
```

(Skip if you want to do a manual smoke test against a real opencode install before tagging.)

---

## Self-review checklist (do not skip)

Before handing the plan to a worker, the plan author confirms:

- [ ] Every shared type used in tasks is defined in Task 1.
- [ ] Every test file referenced in a task exists in the file structure.
- [ ] No "TBD" / "TODO" / "fill in" markers in any step.
- [ ] Every step that changes code includes the code block.
- [ ] Function signatures match across tasks (e.g. `applyRule`, `reportError`, `loadConfigIfChanged`, `resolvePromptText` use the same arguments everywhere).
- [ ] Spec coverage:
  - Config discovery order (Task 7)
  - Strict JSON only (Tasks 7, 10, 12)
  - Glob matching (Tasks 2, 5, 9)
  - Exact match (Task 5, 9)
  - `default` fires only when no explicit rule matched (Tasks 8, 9)
  - Append/replace mutation (Tasks 6, 9)
  - `position: start` and `position: end` (Task 6)
  - mtime cache (Task 7)
  - Fail-loud error blocks (Tasks 4, 8, 9)
  - Lenient mode (Tasks 4, 9)
  - Log file at `<config-dir>/system-prompt-override.log` (Tasks 3, 7, 9)
  - Inline prompts containing `//`, `https://`, `/* */` parse correctly (Task 7)
  - Dedupe of log entries within a config load (Task 4)
  - Hook handler never throws (Task 8)
