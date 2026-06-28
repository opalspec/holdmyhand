# Hold My Hand

**Ask a plain-English question about a codebase and get an interactive,
step-by-step walkthrough in your browser** — real code excerpts with file
references, beginner-friendly explanations, prev/next navigation, and per-step
follow-up questions that are answered and saved.

> *"How does the achievements and events system work?"* → a guided tour of the
> exact files, in the right order, that answers it.

Hold My Hand is a **Claude Code plugin**: it runs inside your Claude Code session,
already in your repo, so it can read the real code to build an accurate walkthrough.
It's a companion to [OpalSpec](https://opalspec.dev) — but works **standalone** or
alongside **any** spec-driven framework. Name a spec and it reads both the spec and the
code that fulfilled it, so you can see how the plan became reality, understand what was actually done and compare to the intended design:

> *"Walk me through what the `passkey-login` spec actually implemented."* → a tour
> that maps each part of the plan to the code it became.

## Requirements

- [Claude Code](https://code.claude.com) installed and authenticated (`claude` on PATH).
- Node.js ≥ 20.19 on PATH.

## Install

In any Claude Code session:

```
/plugin marketplace add opalspec/holdmyhand
/plugin install hold-my-hand@holdmyhand
```

On first use you'll approve the bundled `hmh` MCP server and trust the workspace —
expected, since the plugin runs a small local server.

Update later with `/plugin marketplace update` (install does not auto-update).

## Use

Three commands, all run by you:

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
tracked `.gitignore` and nothing leaks into your commits. Deleting `.hmh/` (or any
file in it) is always safe.

## Configuration (optional)

HMH picks a local port automatically (starting at `7345`, with fallback if it's
busy), so there's usually nothing to configure. To pin a specific port, create
`.hmh/config.json` in your repo:

```json
{ "port": 8000 }
```

It lives with your data and survives plugin updates. (An `HMH_PORT` environment
variable overrides it.)

## Updating

```
/plugin marketplace update
```

Re-fetches the latest version. (Install does not auto-update — run this to pull
changes.)

## License

MIT
