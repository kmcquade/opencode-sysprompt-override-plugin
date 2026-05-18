# opencode-sysprompt-override-plugin

An [opencode](https://github.com/anomalyco/opencode) plugin that lets you override or extend the system prompt on a per-model basis from a config file.

## Why

opencode ships a different base system prompt for each model family — `anthropic.txt`, `gpt.txt`, `gemini.txt`, `kimi.txt`, `trinity.txt`, and a catch-all `default.txt` for everything else (qwen, deepseek, llama, mistral, etc.). Selection is a substring match on `model.api.id` in [`packages/opencode/src/session/system.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/system.ts).

That's fine until you want to:

- Tell a specific model "you're operating in a security-sensitive context, follow least-privilege"
- Replace the default qwen/deepseek prompt with something tighter
- Layer a global "be concise, no preamble" overlay on every model
- Customize the prompt for a model opencode doesn't have a baked-in prompt for

There's no built-in way to do that. This plugin fills the gap.

## How it works

opencode exposes an `experimental.chat.system.transform` hook (in [`packages/plugin/src/index.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts)) that fires before every LLM call — interactive chat, agent sub-runs, and `opencode serve` HTTP requests alike. The hook receives a mutable `output.system: string[]` that becomes the system messages sent to the model.

This plugin reads a JSON config file, matches rules against the current `{ providerID, model.id }`, and applies them in order. Each rule is either:

- **append** — add a prompt to the existing system messages (default; preserves opencode's prompt caching)
- **replace** — wipe opencode's base prompt and substitute your own (use with care — opencode's base prompts contain tool-use instructions)

A `default` rule fires only when no explicit rule matched, so it acts as a fallback rather than a global overlay.

## Status

In design. The full build spec — including verified file/line references into the opencode source, the config schema, locked design decisions, a plugin skeleton, and the test plan — is in [`SPEC.md`](./SPEC.md). The plugin itself hasn't been built yet.

## Layout

```
.
├── SPEC.md         # build spec — hand this to a coding agent
├── README.md       # you are here
└── repos/
    └── opencode/   # cloned for spec verification (gitignored)
```

## Next steps

1. Implement `.opencode/plugin/system-prompt-override.ts` per `SPEC.md`.
2. Write the JSON schema and example config.
3. Add tests (unit + integration following opencode's `withProject` harness).
4. Publish as an npm package or ship as a drop-in file in `.opencode/plugin/`.
