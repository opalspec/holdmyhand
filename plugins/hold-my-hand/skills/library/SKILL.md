---
description: Open the library of walkthroughs already saved for this codebase, in the browser. Use when the user runs /hold-my-hand:library.
disable-model-invocation: true
argument-hint: "(no arguments)"
allowed-tools:
---

# Hold My Hand — library

The user wants to see the walkthroughs already saved for this codebase.

1. Call the MCP tool **`open_library`** (no arguments). It ensures the local server is
   running and opens the `/library` page, which lists every saved walkthrough (grouped
   by question, newest first) with an **Open** button on each.
2. Report the URL it returns.

That page is the entry point for restoring a walkthrough. To restore a specific one from
the chat instead, use `/hold-my-hand:open <id>`. Do **not** use `/hold-my-hand:explain`
for restore — that would generate a brand-new walkthrough.
