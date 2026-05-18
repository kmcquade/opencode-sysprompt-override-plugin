// @ts-nocheck
/**
 * Smoke 3: Real opencode + real Anthropic LLM.
 *
 * Builds dist/index.js if needed, sets up a temp project dir with the plugin
 * and a system-prompts.json that forces the model to echo a unique nonce phrase,
 * then runs opencode against Anthropic's API and asserts the response contains
 * the nonce.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=<key> bun scripts/smoke-live.ts
 * Or via Makefile:
 *   make smoke-live
 *
 * The ANTHROPIC_API_KEY must be set in the environment before invoking this script.
 * It is NOT read from .env here.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

// Prefer env override, then try ~/.opencode/bin/opencode, then fall back to PATH lookup.
const OPENCODE_BIN = (() => {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  const candidate = join(home, ".opencode", "bin", "opencode")
  if (existsSync(candidate)) return candidate
  // Fall back to bare name (must be on PATH)
  return "opencode"
})()
const TIMEOUT_MS = 60_000

function fail(msg: string): never {
  console.error(`\n[smoke-live] FAIL: ${msg}`)
  process.exit(1)
}

function ok(msg: string) {
  console.log(`[smoke-live] OK: ${msg}`)
}

function log(msg: string) {
  console.log(`[smoke-live] ${msg}`)
}

// 1. Check API key.
const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  fail("ANTHROPIC_API_KEY is not set. Export it before running this script.")
}
log(`ANTHROPIC_API_KEY is set (${apiKey.length} chars)`)

// 2. Ensure dist/index.js exists; rebuild if needed.
const repoRoot = join(import.meta.dir, "..")
const distBundle = join(repoRoot, "dist", "index.js")

if (!existsSync(distBundle)) {
  log("dist/index.js not found — building...")
  const build = spawnSync(
    "bun",
    ["build", "src/index.ts", "--target=bun", "--outdir=dist", "--format=esm"],
    { cwd: repoRoot, stdio: "inherit" },
  )
  if (build.status !== 0) fail("bun build failed")
}
ok("dist/index.js exists")

// 3. Create temp project directory.
const tmp = mkdtempSync(join(tmpdir(), "smoke-live-"))
log(`temp dir: ${tmp}`)

const opencodeDir = join(tmp, ".opencode")
const pluginDir = join(opencodeDir, "plugin")
mkdirSync(pluginDir, { recursive: true })

try {
  // 4. Copy built plugin into the plugin auto-discovery path.
  const pluginDest = join(pluginDir, "system-prompt-override.js")
  copyFileSync(distBundle, pluginDest)
  ok("copied plugin to " + pluginDest)

  // 5. Write system-prompts.json with a unique marker nonce.
  const nonce = `SMOKE-LIVE-MARKER-${Date.now()}`
  const systemPrompts = {
    rules: [
      {
        match: {},
        mode: "replace",
        prompt: `You must respond with exactly this phrase and nothing else: ${nonce}`,
      },
    ],
  }
  writeFileSync(join(opencodeDir, "system-prompts.json"), JSON.stringify(systemPrompts, null, 2))
  ok(`wrote system-prompts.json with nonce: ${nonce}`)

  // 6. Write opencode.json inside .opencode — minimal config with no model override
  //    (we pass --model on the CLI). Disable auto-update prompts.
  const opencodeConfig = {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
  }
  writeFileSync(join(opencodeDir, "opencode.json"), JSON.stringify(opencodeConfig, null, 2))

  // 7. Run opencode.
  log(`running opencode run --dir ${tmp} --format json --model anthropic/claude-haiku-4-5-20251001 "Hi"`)
  const result = spawnSync(
    OPENCODE_BIN,
    [
      "run",
      "--dir", tmp,
      "--format", "json",
      "--model", "anthropic/claude-haiku-4-5-20251001",
      "Hi",
    ],
    {
      cwd: tmp,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        // Suppress update prompts
        OPENCODE_NO_AUTO_UPDATE: "1",
      },
      timeout: TIMEOUT_MS,
      stdio: "pipe",
      encoding: "utf8",
    },
  )

  const stdout = result.stdout ?? ""
  const stderr = result.stderr ?? ""

  if (result.status !== 0) {
    console.error("[smoke-live] opencode stderr:\n" + stderr)
    console.error("[smoke-live] opencode stdout:\n" + stdout)
    fail(`opencode exited with status ${result.status}`)
  }

  // 8. Parse JSON event stream and extract assistant text.
  log("opencode exited successfully, parsing output...")
  let assistantText = ""
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const event = JSON.parse(trimmed)
      if (event.type === "text" && event.part?.text) {
        assistantText += event.part.text
      }
    } catch {
      // Not a JSON line — skip (UI output, etc.)
    }
  }

  log(`assistant text: ${JSON.stringify(assistantText.slice(0, 200))}`)

  // 9. Assert nonce is present.
  // Prefer exact match but fall back to partial ("SMOKE-LIVE-MARKER") in case
  // the model adds whitespace or casing variation.
  if (assistantText.includes(nonce)) {
    ok(`exact nonce found in response: "${nonce}"`)
  } else if (assistantText.includes("SMOKE-LIVE-MARKER")) {
    ok(`partial nonce found in response (model deviated slightly from exact phrase)`)
  } else {
    console.error("[smoke-live] Full assistant response:\n" + assistantText)
    console.error("[smoke-live] Full stdout:\n" + stdout)
    fail(`nonce "${nonce}" not found in assistant response. System prompt override did not take effect.`)
  }

} finally {
  // 10. Cleanup.
  rmSync(tmp, { recursive: true, force: true })
  log(`cleaned up ${tmp}`)
}

log("smoke-live PASSED")
process.exit(0)
