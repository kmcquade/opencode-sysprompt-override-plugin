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
make test       # bun test ./test/
make build      # bun build + tsc --emitDeclarationOnly
make ci         # install + test + build (same target CI runs)
```

CI is local-CI-parity: the GH Actions workflow runs `make ci` and nothing else. To reproduce a CI failure locally, run `make ci`.

## License

MIT
