# Hold My Hand (Claude Code plugin)

Ask a plain-English question about the codebase you're in — *"how does the achievements
and events system work?"* — and get an **interactive, step-by-step walkthrough** in your
browser: real code excerpts, beginner-friendly explanations, prev/next navigation, and
per-step follow-up questions.

## Install

```
/plugin marketplace add opalspec/holdmyhand
/plugin install hold-my-hand@holdmyhand
```

On first use you'll be asked to approve the bundled `hmh` MCP server and trust the
workspace.

## Use

```
/hold-my-hand:explain how does the achievements and events system work?
/hold-my-hand:library            # browse walkthroughs saved for this repo
/hold-my-hand:open <id>          # restore a specific saved walkthrough
```

The in-session agent inspects your repo, builds the walkthrough, and hands it to the
bundled MCP server, which validates it, **verifies every code excerpt against the real
files**, saves it under `.hmh/`, serves it on `127.0.0.1`, and opens your browser. Ask a
follow-up on any step in the page and it's answered (via a guarded `claude -p`) and saved.

## Persistence

Walkthroughs (and their Q&A) are saved in `.hmh/` inside the codebase. That folder is
**self-ignoring** (`.hmh/.gitignore` is `*`), so it never touches your tracked
`.gitignore`. Each walkthrough is stamped with the git commit + working-tree state it was
built against; restoring one against changed code shows a staleness banner with a
**Regenerate** affordance.

## How it's built

The MCP server is a single committed bundle at `dist/hmh-mcp.mjs` (esbuild bundles the
agnostic `@hmh/core`, the Claude adapter, `zod`, the MCP SDK, and the HTML templates), so
it runs from the installed plugin with no `npm install`. Source lives in the repo root
(`src/`); rebuild with `npm run build:plugin`.
