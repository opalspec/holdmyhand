# Hold My Hand (HMH)

Ask a plain-English question about a codebase — *"how does the achievements and
events system work?"* — and get an interactive, step-by-step walkthrough in your
browser: simple explanations, real code excerpts, forward/back navigation, and a
box to ask follow-ups that refine the walkthrough in place.

Companion to [OpalSpec](https://opalspec.dev). This is the **Phase 1 POC**: a
standalone CLI that drives Claude Code against a target codebase. See
`Planning/PLAN.md` for the full phased plan (POC → plugin → multi-tool).

## Requirements

- Node.js ≥ 20.19
- [Claude Code](https://code.claude.com) installed and authenticated (the `claude`
  CLI must be on your PATH)

## Setup

```bash
npm install
```

Point HMH at the codebase you want explained by editing `hmh.config.json`:

```json
{ "codebasePath": "C:/path/to/your/codebase", "port": 4173 }
```

(For a machine-specific path you don't want committed, use `hmh.config.local.json`
— it's gitignored and overrides `hmh.config.json`.)

## Use

```bash
node bin/hmh.js "how does the achievements and events system work?"
```

HMH inspects the codebase, builds the walkthrough, starts a local server, and opens
your browser. Navigate with ← / → or the buttons; ask a follow-up at the bottom to
update the walkthrough live.

Options: `--port <n>`, `--no-open`, `--help`.

## How it works (POC)

```
bin/hmh.js            CLI entry: parse question, load config, generate, serve
src/core/             @hmh/core — agent- & delivery-agnostic
  schema.js           zod walkthrough schema + parse/validate (+ prompt description)
  prompt.js           question (+ prior) -> agent instructions
  engine.js           orchestrator: prompt -> adapter -> validated walkthrough
  render.js           pure: walkthrough -> HTML
  templates/walkthrough.html
src/adapters/
  claude.js           `claude -p` headless adapter (the only Claude-aware module)
src/cli/
  config.js           reads hmh.config.json
  serve.js            local server + /api/ask follow-up endpoint
```

The core knows nothing about Claude, the CLI, or HTTP. That's what lets Phase 2
re-wrap the same core as a Claude Code plugin.
