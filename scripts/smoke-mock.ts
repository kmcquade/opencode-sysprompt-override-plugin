// @ts-nocheck
/**
 * Smoke 2: Real opencode + mock LLM provider.
 *
 * Proves opencode loads our plugin via auto-discovery and invokes the hook,
 * without spending money or requiring an API key.
 *
 * Algorithm:
 *  1. Build dist/index.js if missing.
 *  2. Spin up a local HTTP mock server on a random port that speaks the
 *     OpenAI Chat Completions API (non-streaming JSON response).
 *  3. Create a temp project dir T with:
 *       T/.opencode/plugin/system-prompt-override.js  (copy of dist/index.js)
 *       T/.opencode/system-prompts.json               (replace rule with nonce)
 *       T/.opencode/opencode.json                     (custom provider pointing at mock)
 *  4. Spawn opencode run --dir T --format json --model mock/mock-model "hello"
 *     asynchronously so the mock server can handle incoming requests.
 *  5. After opencode exits (or 60s timeout), assert the mock server received
 *     a request whose messages array contains a system message with the nonce.
 *  6. Cleanup server + temp dir.
 *  7. Exit 0 on success, non-zero on failure.
 *
 * Run via: make smoke-mock
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, copyFileSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { spawn } from "node:child_process"

// ----- helpers ---------------------------------------------------------------

const TIMEOUT_MS = 60_000

// Resolve opencode binary
const OPENCODE_BIN = (() => {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  const candidate = join(home, ".opencode", "bin", "opencode")
  if (existsSync(candidate)) return candidate
  return "opencode"
})()

const repoRoot = join(import.meta.dir, "..")
const distBundle = join(repoRoot, "dist", "index.js")

function fail(msg: string): never {
  console.error(`\n[smoke-mock] FAIL: ${msg}`)
  process.exit(1)
}
function ok(msg: string) { console.log(`[smoke-mock] OK: ${msg}`) }
function log(msg: string) { console.log(`[smoke-mock] ${msg}`) }

// ----- 1. Build if needed ----------------------------------------------------

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

// ----- 2. Spin up mock server ------------------------------------------------

// Buffer to collect received request bodies.
const receivedBodies: any[] = []

async function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

const server = createServer(async (req, res) => {
  // Accept any POST to any path under /v1/
  if (req.method === "POST") {
    const body = await readBody(req)
    let parsed: any = null
    try { parsed = JSON.parse(body) } catch { /* ignore */ }
    if (parsed) receivedBodies.push(parsed)
    log(`mock received POST ${req.url} — messages: ${parsed?.messages?.length ?? "?"}`)

    // Return a minimal non-streaming chat completion response.
    const response = {
      id: "chatcmpl-mock-1",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "mock-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Mock response from smoke test.",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18,
      },
    }

    const payload = JSON.stringify(response)
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "Connection": "close",
    })
    res.end(payload)
    return
  }

  // GET /v1/models — some providers probe this
  if (req.method === "GET" && req.url?.includes("/models")) {
    const payload = JSON.stringify({
      object: "list",
      data: [{ id: "mock-model", object: "model", created: 0, owned_by: "mock" }],
    })
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Connection": "close",
    })
    res.end(payload)
    return
  }

  res.writeHead(404, { "Connection": "close" })
  res.end()
})

// Bind to port 0 (random) and wait for it to be ready.
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const addr = server.address() as { port: number }
const mockPort = addr.port
// unref() so the server doesn't prevent Bun from exiting
server.unref()
ok(`mock server listening on http://127.0.0.1:${mockPort}`)

// ----- 3. Create temp project dir --------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), "smoke-mock-"))
log(`temp dir: ${tmp}`)

const opencodeDir = join(tmp, ".opencode")
const pluginDir = join(opencodeDir, "plugin")
mkdirSync(pluginDir, { recursive: true })

async function cleanup() {
  rmSync(tmp, { recursive: true, force: true })
  log(`cleaned up ${tmp}`)
  server.closeAllConnections?.()
  server.close()
}

try {
  // Pre-seed node_modules so opencode's background `bun install @opencode-ai/plugin`
  // sees the package already present and skips the slow npm reify. Without this,
  // opencode hangs in waitForDependencies() for 30-60 seconds on a fresh tmpdir.
  const nmDir = join(opencodeDir, "node_modules", "@opencode-ai")
  mkdirSync(nmDir, { recursive: true })
  const pluginSrc = join(repoRoot, "node_modules", "@opencode-ai", "plugin")
  if (existsSync(pluginSrc)) {
    symlinkSync(pluginSrc, join(nmDir, "plugin"))
    ok("symlinked @opencode-ai/plugin into temp node_modules")
  }

  // Write a package.json + package-lock.json so the npm check considers the dir
  // up-to-date and does not trigger a reinstall.
  const pluginPkg = JSON.parse(
    require("fs").readFileSync(join(pluginSrc, "package.json"), "utf8"),
  )
  const pluginVersion = pluginPkg.version ?? "0.0.0"
  writeFileSync(
    join(opencodeDir, "package.json"),
    JSON.stringify(
      { name: "opencode-plugins", version: "0.0.0", private: true, dependencies: { "@opencode-ai/plugin": pluginVersion } },
      null,
      2,
    ),
  )
  writeFileSync(
    join(opencodeDir, "package-lock.json"),
    JSON.stringify(
      {
        name: "opencode-plugins",
        version: "0.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": {
            name: "opencode-plugins",
            version: "0.0.0",
            dependencies: { "@opencode-ai/plugin": pluginVersion },
          },
        },
      },
      null,
      2,
    ),
  )
  ok("pre-seeded package.json and package-lock.json in .opencode dir")

  // Copy plugin bundle.
  const pluginDest = join(pluginDir, "system-prompt-override.js")
  copyFileSync(distBundle, pluginDest)
  ok("copied plugin to " + pluginDest)

  // Write system-prompts.json with a unique nonce.
  const nonce = `SMOKE-MOCK-MARKER-${Date.now()}`
  writeFileSync(
    join(opencodeDir, "system-prompts.json"),
    JSON.stringify({
      rules: [{ match: {}, mode: "replace", prompt: nonce }],
    }, null, 2),
  )
  ok(`wrote system-prompts.json with nonce: ${nonce}`)

  // Write opencode.json with a custom provider pointing at the mock server.
  // The provider ID is "mock", model ID is "mock-model".
  // npm package is @ai-sdk/openai-compatible (bundled in opencode).
  const opencodeConfig = {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    // Only enable our mock provider; disable everything else to speed up init.
    enabled_providers: ["mock"],
    provider: {
      mock: {
        name: "Mock LLM",
        npm: "@ai-sdk/openai-compatible",
        env: [],
        options: {
          baseURL: `http://127.0.0.1:${mockPort}/v1`,
          apiKey: "mock-key",
        },
        models: {
          "mock-model": {
            name: "Mock Model",
            limit: { context: 8192, output: 2048 },
          },
        },
      },
    },
  }
  writeFileSync(join(opencodeDir, "opencode.json"), JSON.stringify(opencodeConfig, null, 2))
  ok("wrote opencode.json with mock provider config")

  // ----- 4. Spawn opencode asynchronously (so mock server handles requests) ----

  log(`spawning: ${OPENCODE_BIN} run --dir ${tmp} --format json --model mock/mock-model "hello"`)

  const stdoutLines: string[] = []
  const stderrLines: string[] = []

  const opencodeProcess = spawn(
    OPENCODE_BIN,
    [
      "run",
      "--dir", tmp,
      "--format", "json",
      "--model", "mock/mock-model",
      "hello",
    ],
    {
      cwd: tmp,
      env: {
        ...process.env,
        OPENAI_API_KEY: "mock-key",
        OPENCODE_NO_AUTO_UPDATE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  )

  // Close stdin immediately — opencode reads `Bun.stdin.text()` when stdin is not a TTY,
  // and hangs forever if stdin is an open pipe with no EOF. Sending EOF right away is
  // equivalent to the shell's behaviour where stdin is a closed pipe.
  opencodeProcess.stdin?.end()

  opencodeProcess.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    stdoutLines.push(text)
  })
  opencodeProcess.stderr?.on("data", (chunk: Buffer) => {
    stderrLines.push(chunk.toString())
  })

  // Wait for opencode to finish (with timeout).
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      opencodeProcess.kill("SIGTERM")
      resolve(null) // null = timed out
    }, TIMEOUT_MS)

    opencodeProcess.on("exit", (code) => {
      clearTimeout(timer)
      resolve(code)
    })
    opencodeProcess.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })

  const stdout = stdoutLines.join("")
  const stderr = stderrLines.join("")

  if (exitCode === null) {
    log(`opencode stderr:\n${stderr.slice(0, 2000)}`)
    log(`opencode stdout:\n${stdout.slice(0, 2000)}`)
    fail(`opencode timed out after ${TIMEOUT_MS}ms`)
  }

  if (exitCode !== 0) {
    log(`opencode stderr:\n${stderr.slice(0, 2000)}`)
    log(`opencode stdout:\n${stdout.slice(0, 2000)}`)
    fail(`opencode exited with status ${exitCode}`)
  }

  ok("opencode exited successfully")
  log(`received ${receivedBodies.length} request(s) at mock server`)

  // ----- 5. Assert nonce in captured requests ----------------------------------

  if (receivedBodies.length === 0) {
    log(`opencode stdout:\n${stdout.slice(0, 2000)}`)
    log(`opencode stderr:\n${stderr.slice(0, 2000)}`)
    fail("mock server received zero requests — opencode may not have called the LLM")
  }

  let found = false
  for (const body of receivedBodies) {
    if (!Array.isArray(body.messages)) continue
    for (const msg of body.messages) {
      if (msg.role === "system" && typeof msg.content === "string" && msg.content.includes(nonce)) {
        found = true
        ok(`nonce found in system message of mock request: "${nonce}"`)
        break
      }
    }
    if (found) break
  }

  if (!found) {
    log("captured request bodies:")
    for (const b of receivedBodies) {
      log(JSON.stringify(b.messages ?? b, null, 2))
    }
    fail(`nonce "${nonce}" not found in any system message received by mock server`)
  }

} finally {
  // ----- 6. Cleanup ------------------------------------------------------------
  await cleanup()
}

log("smoke-mock PASSED")
process.exit(0)
