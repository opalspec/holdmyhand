---
description: Generate an interactive, step-by-step walkthrough that answers a plain-English question about THIS codebase, then open it in the browser. Use when the user runs /hold-my-hand:explain with a question.
disable-model-invocation: true
argument-hint: "<a plain-English question about this codebase>"
allowed-tools: Read, Grep, Glob
---

# Hold My Hand — explain

You are building a **guided walkthrough** that answers the user's question about the
codebase you are currently in. The reader is a capable developer who is new to *this*
code. Your output is consumed by a tool, not shown directly — so accuracy and the exact
JSON shape matter more than prose flourish.

## Steps

1. **Inspect the real code.** Use Read / Grep / Glob to find the files and lines that
   actually answer the question. Do **not** guess or rely on memory — open the files.
2. **Build the walkthrough** as a single JSON object matching the schema below:
   - Order steps so each builds on the last and tells a coherent story.
   - Explain in plain English; define jargon the first time you use it.
   - For each step that shows code, quote a **real, verbatim** excerpt and set `file`
     to its **repo-relative** path. Keep excerpts short and on-point. You may omit
     `lines` — the render tool locates the snippet and fills in the real line range.
3. **Render it.** Call the MCP tool **`render_walkthrough`** with `{ "walkthrough": <your JSON> }`.
4. **Self-correct.** If the tool returns validation or source-verification problems, it
   lists each one precisely. Fix exactly those (most often: an excerpt that wasn't found
   verbatim, or a non-relative `file` path) and call `render_walkthrough` again.
5. **Report the URL** it returns. The page opens automatically; the user navigates steps
   and asks per-step follow-ups there (answered for them — you don't need to stay).

Do not start an HTTP server, write files, or open a browser yourself — `render_walkthrough`
does all of that. Your job is the *content*.

## Walkthrough schema

<!-- HMH:SCHEMA:START -->
<!-- GENERATED from src/core/schema.js by build-skill.mjs — do not edit by hand. -->

Produce a single JSON object in exactly this shape:

```json
{
  "version": "0.1",
  "question": "<the original question, echoed back>",
  "title": "<short title for the walkthrough>",
  "summary": "<one-paragraph plain-English overview a beginner can follow>",
  "steps": [
    {
      "id": "step-1",
      "heading": "<short heading for this step>",
      "explanation": "<plain-English, beginner-friendly prose explaining this step>",
      "code": "<optional: a real code excerpt from the codebase>",
      "language": "<optional: language id for syntax, e.g. 'ts', 'js', 'py'>",
      "file": "<optional: path to the file the excerpt is from>",
      "lines": "<optional: line range, e.g. '12-40'>",
      "why": "<optional: why this matters / how it connects to the next step>"
    }
  ],
  "glossary": [
    { "term": "<optional term>", "definition": "<plain-English definition>" }
  ]
}
```

Limits (the render tool enforces these — stay within them):
- At most 40 steps.
- `file` must be a path **relative to the repo root** (no absolute paths, no `..`).
- Keep each `code` excerpt and `explanation` focused (hard caps ~12000 chars).
- Quote real code **verbatim** so the render tool can locate it; if you are paraphrasing, omit `code`.
<!-- HMH:SCHEMA:END -->
