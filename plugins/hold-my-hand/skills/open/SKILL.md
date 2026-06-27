---
description: Restore a specific saved walkthrough by its id (or find it by slug/title) and reopen it in the browser, continuable. Use when the user runs /hold-my-hand:open with an id.
disable-model-invocation: true
argument-hint: "<a walkthrough id (or part of its slug/title)>"
allowed-tools:
---

# Hold My Hand — open

The user wants to restore a previously saved walkthrough and continue it.

1. If they gave an **id**, call the MCP tool **`open_walkthrough`** with `{ "id": "<id>" }`.
2. If they gave a slug fragment or title instead of an exact id, first call
   **`list_walkthroughs`** to find the matching entry, then call `open_walkthrough` with
   its `id`. If several match, briefly list the candidates and ask which one.
3. Report the URL. If the result has `"stale": true`, tell the user the code has changed
   since this walkthrough was built, so some excerpts may be out of date — they can
   regenerate from the page or by re-running `/hold-my-hand:explain`.

Restored walkthroughs are fully continuable: the user can keep asking per-step follow-ups
on the page, and answers are appended and saved.
