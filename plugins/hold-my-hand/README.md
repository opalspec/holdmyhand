# Hold My Hand (Claude Code plugin)

Ask a plain-English question about the codebase you're in — *"how does the
achievements and events system work?"* — and get an **interactive, step-by-step
walkthrough** in your browser: real code excerpts with file references,
beginner-friendly explanations, prev/next navigation, and per-step follow-up
questions that are answered and saved.

## Install

```
/plugin marketplace add opalspec/holdmyhand
/plugin install hold-my-hand@holdmyhand
```

On first use you'll approve the bundled `hmh` MCP server and trust the workspace.

Update later with `/plugin marketplace update` (install does not auto-update).

## Use

```
/hold-my-hand:explain how does the achievements and events system work?
/hold-my-hand:library            # browse walkthroughs saved for this repo
/hold-my-hand:open <id>          # restore a specific saved walkthrough
```

`explain` inspects your repo, builds the walkthrough, and opens it in your browser.
Navigate steps with ← / → or the buttons. On any step, ask a follow-up — it's
answered in context and saved beneath that step, with quick links to related steps.

Reopen a walkthrough after the code has changed and a staleness banner offers to
regenerate it, so excerpts never quietly go out of date.

## Where your walkthroughs are saved

Walkthroughs (and their Q&A) are saved under `.hmh/` inside the codebase. That
folder is **self-ignoring** (`.hmh/.gitignore` is `*`), so it never touches your
tracked `.gitignore` and nothing leaks into your commits. Each walkthrough records
the git commit + working-tree state it was built against, which is what powers the
staleness banner on restore. Deleting `.hmh/` (or any file in it) is always safe.

## Configuration (optional)

HMH serves the page on a local port, picked automatically (starting at `7345`, with
fallback if it's busy) — so you usually don't need to set anything. To pin a
specific port, create `.hmh/config.json` in your repo:

```json
{ "port": 8000 }
```

It lives with your data, so it survives plugin updates. (An `HMH_PORT` environment
variable, if set, overrides it.)
