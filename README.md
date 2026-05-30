# opencode-sysprompt-override

Drop one file into `.opencode/plugin/`, add a JSON config, and override the system prompt opencode sends to any model.

## The 60-second demo

By the end of this section, your Claude session will insist that **hot dogs are sandwiches**.

```bash
# 1. From a project where you run opencode:
mkdir -p .opencode/plugin .opencode/prompts

# 2. Pull opencode's real Claude system prompt as a starting point,
#    so the model keeps all its tool-use instructions.
curl -fsSL https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/session/prompt/anthropic.txt \
  -o .opencode/prompts/anthropic-base.md

# 3. Append one line — your custom rule.
cat >> .opencode/prompts/anthropic-base.md <<'EOF'

When the user says "hot dogs", you respond with exactly: "Are Sandwiches."
EOF

# 4. Drop the plugin in (one file, no install).
curl -fsSL https://cdn.jsdelivr.net/npm/opencode-sysprompt-override/dist/index.js \
  -o .opencode/plugin/system-prompt-override.js

# 5. Wire it up.
cat > .opencode/system-prompts.json <<'EOF'
{
  "rules": [
    {
      "match": { "providerID": "anthropic" },
      "mode": "replace",
      "promptFile": "./prompts/anthropic-base.md"
    }
  ]
}
EOF
```

Now run `opencode` in that directory and type:

> hot dogs

Claude will reply: **Are Sandwiches.**

<img width="571" height="416" alt="image" src="https://github.com/user-attachments/assets/abcb49d1-39ff-4608-a1a9-e6d173316c33" />

Want to undo it? Delete `.opencode/plugin/system-prompt-override.js`. Want to change the rule? Edit `.opencode/system-prompts.json` — the next message picks up the change, no restart.

## What this is actually for

The hot-dog demo is silly, but the pattern is real. opencode ships a different base prompt for each model family (`anthropic.txt`, `gpt.txt`, `gemini.txt`, `kimi.txt`, `trinity.txt`, `default.txt`). There's no built-in way to override or extend them per-model. This plugin gives you that knob:

- **Replace the prompt** for one model (or a glob of models). `mode: "replace"` wipes opencode's base; you write the whole thing.
- **Append to the prompt** — leave opencode's prompt intact, add your own rules at the end. `mode: "append"` is what you want most of the time.
- **Layer a global overlay** on every model — write a rule with no `match`, it applies to all of them.
- **Customize models opencode doesn't have a baked-in prompt for** (deepseek, llama, your local Ollama setup, anything that falls through to `default.txt`).

Real reasons people reach for this:
- Tell a specific model "you're operating in a security-sensitive context, follow least-privilege"
- Tighten the default prompt for qwen / deepseek / llama
- Force every model to start with "Be concise. No preamble."
- Add company- or project-specific instructions without forking opencode

## Install

Two paths. The demo above used path A.

**A. Drop-in (no package manager):** the one-line `curl` from the demo. The plugin is a single ESM file; opencode auto-discovers anything in `.opencode/plugin/`.

**B. npm:**
```bash
npm install opencode-sysprompt-override
```
Then in your `opencode.json`:
```json
{
  "plugin": ["opencode-sysprompt-override"]
}
```

## Config reference

The plugin looks for a config file at these locations, in order:

1. `$OPENCODE_SYSTEM_PROMPT_CONFIG` (env var, absolute path)
2. `<project>/.opencode/system-prompts.json`
3. `~/.config/opencode/system-prompts.json`
4. `~/.opencode/system-prompts.json`

The config is **strict JSON** — no comments, no trailing commas. (Comment-stripping would corrupt inline prompts that contain `//` or `https://`.)

### Full schema

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
- `lenient` (boolean, default `false`) — see "Error model" below.
- `default` — rule applied when no explicit rule matched (no `match` field).
- `rules` — ordered list of rules.

**`match`** (all fields optional, AND-semantics across populated fields):
- `providerID` — exact match on `model.providerID`
- `providerIDGlob` — glob (`*`, `?`) on `model.providerID`
- `modelID` — exact match on `model.id`
- `modelIDGlob` — glob on `model.id`

A rule with no `match` (or empty `{}`) applies to every model.

**Rule body:**
- `mode` — `"append"` adds to the existing system prompt; `"replace"` wipes opencode's base prompt and substitutes yours.
- `position` — `"end"` (default) or `"start"`. Only meaningful for `append`.
- Exactly one of:
  - `prompt` — inline string.
  - `promptFile` — path to a file (relative to the config's directory, or absolute).

### Precedence

1. All matching rules in `rules` apply, in declared order.
2. If no explicit rule matched, `default` applies (if present).
3. `replace` clears `output.system` before writing its prompt; later rules apply on top.

## Error model

The plugin's job is to enforce custom system instructions, so silent failure is the wrong default. Every config or rule error is reported through **two always-on channels**, regardless of mode:

1. A JSON line appended to `<config-dir>/system-prompt-override.log`.
2. A single structured line written to **stderr** via `console.error`, so the error reaches the host process's stderr even when nobody reads the log file:

   ```
   [opencode-sysprompt-override] error code=promptfile-error ruleIndex=0 path=/ws/.opencode/system-prompts.json msg="ENOENT: ./prompts/missing.md"
   ```

   One line per unique `(code, path, ruleIndex)` — deduped, never loop-spammed — and it never contains prompt bodies or secrets, only the code, a short message, the path, and the rule index (`-` when not applicable).

On top of that reporting, the default mode is **fail-loud**: any error also injects a visible `<SYSTEM POLICY ERROR: ...>` block at the front of the system prompt.

```
<SYSTEM POLICY ERROR: promptfile-error: ENOENT: ./prompts/missing.md>
The opencode-sysprompt-override plugin failed to apply this rule. See /path/to/system-prompt-override.log for details.
```

Setting `"lenient": true` in the config root switches to skip-the-block — no injected `<SYSTEM POLICY ERROR>` blocks. Lenient governs **only** that block; the file log and the stderr line are emitted either way. Use lenient during config development if the visible blocks are noisy.

The log file is append-only. Rotation is your responsibility.

## Caveats

1. The hook is `experimental.chat.system.transform`. opencode may rename it without a major-version bump. Pin your opencode version if this matters.
2. `mode: "replace"` discards opencode's per-model base prompt — those include tool-use instructions the agent relies on. Prefer `append` unless you're starting from a copy of opencode's prompt like the demo above.
3. `append` with `position: "end"` (the default) preserves opencode's 2-part prompt-cache header. `position: "start"` and `mode: "replace"` modify `system[0]`, which skips opencode's rejoin and changes cache shape.
4. The hook fires on every LLM call — chat turns, agent sub-runs, HTTP server requests alike.

## Development

```bash
make install      # bun install
make test         # bun test ./test/
make build        # bun build + tsc --emitDeclarationOnly
make ci           # install + test + build + smoke-bundle
make smoke-mock   # real opencode + local mock LLM provider
make smoke-live   # real opencode + real Anthropic (needs ANTHROPIC_API_KEY)
```

CI is local-CI-parity: every workflow step has a matching `make` target. To reproduce a CI failure locally, run the same target.

## License

MIT
