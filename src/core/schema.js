// @hmh/core — schemas (single source of truth).
//
// Defined once in zod and used for: (a) validating agent output, (b) producing
// precise repair-loop errors, and (c) deriving the schema descriptions injected
// into prompts — so "what we validate" and "what we told the model to produce"
// can never drift.

import { z } from 'zod';

export const SCHEMA_VERSION = '0.1';

// Persisted-file schema version. Bump when the on-disk shape changes; persist.js
// keys its lenient/migrating load() on this (independent of the content `version`
// above, which describes the walkthrough payload itself).
export const FILE_SCHEMA_VERSION = '1';

// Schema limits (finding I2). Enforced so a single tool call can't blow up the
// MCP payload, the browser, or the filesystem — and so paths stay inside the repo.
export const LIMITS = Object.freeze({
  maxSteps: 40,
  maxHeading: 300,
  maxExplanation: 12_000,
  maxCode: 12_000,
  maxWhy: 4_000,
  maxAnswer: 12_000,
  maxSummary: 4_000,
  maxTitle: 300,
  maxQuestion: 600,
  maxGlossary: 60,
  maxSlug: 60,
});

// A path the agent claims an excerpt came from: must be RELATIVE and stay inside
// the repo. Reject absolute paths (unix `/…`, windows `C:\…`, UNC `\\…`) and any
// `..` traversal. Empty/omitted is allowed (file is optional).
const repoRelativeFile = z
  .string()
  .max(400)
  .refine((p) => {
    const norm = p.replace(/\\/g, '/').trim();
    if (norm === '') return true;
    if (norm.startsWith('/')) return false; // posix absolute
    if (/^[a-zA-Z]:/.test(norm)) return false; // windows drive (C:/…)
    if (norm.startsWith('//')) return false; // UNC / network
    return !norm.split('/').includes('..'); // no traversal
  }, { message: 'file must be a relative path inside the repo (no absolute paths, drive letters, or "..")' });

// A follow-up Q&A attached to a step. Additive: asking never changes the step's
// core content, it only appends one of these.
const qaEntrySchema = z.object({
  question: z.string().min(1).max(LIMITS.maxQuestion),
  answer: z.string().min(1).max(LIMITS.maxAnswer),
  relatedSteps: z.array(z.string()).optional().default([]),
  askedAt: z.string().optional(), // stamped by the server when persisted
});

const stepSchema = z.object({
  id: z.string().optional(), // filled in post-parse if the agent omits it
  heading: z.string().min(1).max(LIMITS.maxHeading),
  explanation: z.string().min(1).max(LIMITS.maxExplanation),
  code: z.string().max(LIMITS.maxCode).optional(),
  language: z.string().max(40).optional(),
  file: repoRelativeFile.optional(),
  lines: z.string().max(40).optional(),
  why: z.string().max(LIMITS.maxWhy).optional(),
  qa: z.array(qaEntrySchema).optional(),
});

const glossaryEntrySchema = z.object({
  term: z.string().min(1).max(200),
  definition: z.string().min(1).max(2_000),
});

export const walkthroughSchema = z.object({
  version: z.string().default(SCHEMA_VERSION),
  question: z.string().min(1).max(LIMITS.maxQuestion),
  title: z.string().min(1).max(LIMITS.maxTitle),
  summary: z.string().min(1).max(LIMITS.maxSummary),
  steps: z.array(stepSchema).min(1).max(LIMITS.maxSteps),
  glossary: z.array(glossaryEntrySchema).max(LIMITS.maxGlossary).optional(),

  // ── Server-stamped persistence metadata (§4) ──────────────────────────────
  // The agent never sets these; the MCP server stamps them on save. They are
  // optional here so the same schema validates fresh agent output (no stamps)
  // and reloaded files (stamps present).
  id: z.string().optional(),
  slug: z.string().max(LIMITS.maxSlug).optional(),
  schemaVersion: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  builtAtSha: z.string().nullable().optional(),
  builtAtDirtyHash: z.string().nullable().optional(),
});

// The focused "answer a question about a step" response. Small + cheap: the
// agent returns just an answer plus the ids of any other relevant steps.
export const answerSchema = z.object({
  answer: z.string().min(1),
  relatedSteps: z.array(z.string()).optional().default([]),
});

/**
 * Description of the walkthrough schema, injected into the generation prompt.
 */
export const schemaDescription = `{
  "version": "${SCHEMA_VERSION}",
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
}`;

/**
 * Description of the answer schema, injected into the follow-up prompt.
 */
export const answerSchemaDescription = `{
  "answer": "<plain-English answer to the reader's question about this step>",
  "relatedSteps": ["<optional: ids of OTHER steps whose content is relevant to this answer, e.g. 'step-3'>"]
}`;

function formatZodError(error) {
  return error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

// Shared: strip Markdown fences / surrounding prose and JSON.parse. Throws a
// diagnosable error (including a snippet of what the agent actually said).
function parseLooseJson(rawText) {
  let text = String(rawText ?? '').trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  } else if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    const snippet = String(rawText ?? '').trim().slice(0, 280);
    throw new Error(
      `Agent did not return valid JSON (${err.message}). Response began: ${JSON.stringify(snippet)}`,
    );
  }
}

/**
 * Parse raw agent text into a validated walkthrough (fills missing step ids).
 */
export function extractWalkthrough(rawText) {
  const obj = parseLooseJson(rawText);
  const result = walkthroughSchema.safeParse(obj);
  if (!result.success) {
    throw new Error(`Walkthrough failed schema validation:\n${formatZodError(result.error)}`);
  }
  const walkthrough = result.data;
  walkthrough.steps.forEach((step, i) => {
    if (!step.id) step.id = `step-${i + 1}`;
  });
  return walkthrough;
}

/**
 * Parse raw agent text into a validated answer (for a step follow-up).
 */
export function extractAnswer(rawText) {
  const obj = parseLooseJson(rawText);
  const result = answerSchema.safeParse(obj);
  if (!result.success) {
    throw new Error(`Answer failed schema validation:\n${formatZodError(result.error)}`);
  }
  return result.data;
}
