// @hmh/core — prompt builder. Turns a question into agent instructions.
// Agent-agnostic: it produces text; an adapter decides how to run it.

import { schemaDescription, answerSchemaDescription } from './schema.js';

const JSON_ONLY_RULES = `Output format (CRITICAL — follow exactly):
- Your ENTIRE response must be a single raw JSON object: the first character is "{" and the last is "}".
- Nothing before it and nothing after it. No Markdown code fences, no comments.
- Do NOT write any preamble, explanation, apology, or sign-off — not even one sentence.
- Do NOT refuse, hedge, or ask for clarification, and never begin with phrases like "I don't", "I can't", "Here is", or "Sure". If information is incomplete, still return your best effort as JSON.`;

const EXPLANATION_QUALITY_RULES = `Quality bar:
- Start with the direct answer, then build the explanation.
- Prefer concrete examples over broad generalities.
- Tie claims back to this codebase. When you mention code that exists here, inspect it first.
- Use small code excerpts or pseudo-code when they make the explanation clearer.
- Label pseudo-code clearly; do not present invented code as existing code.
- For design or "which pattern?" questions, compare the local approach with relevant alternatives, include tradeoffs, and end with a decision rule.
- Mention popular frameworks, libraries, or industry practices only when they are genuinely relevant to the user's question. If an option is not implemented in this codebase, say so clearly.
- Keep simple questions concise; add deeper sections only when they materially improve the answer.`;

const GENERATE_RULES = `You are explaining a codebase to someone who is smart but unfamiliar with it.

Your job:
1. Thoroughly inspect the actual codebase using your file-reading and search tools. Do not guess — read the real files.
2. Build a clear, step-by-step walkthrough that answers the question in plain English.
3. Explain things simply. Avoid jargon; when you must use a term, explain it. Assume the reader is a capable developer but new to THIS code.
4. Use REAL code excerpts from the codebase, with the file path and (where possible) line range. Keep excerpts short and focused on the point being made.
5. Order the steps so each one builds on the last, telling a coherent story.

${EXPLANATION_QUALITY_RULES}

${JSON_ONLY_RULES}
- The JSON MUST match this shape exactly:

${schemaDescription}`;

/**
 * Reminder appended to the original prompt on a repair retry (when the agent's
 * first reply wasn't valid JSON). Keeps the full original context intact.
 * @param {string} error
 */
export function repairSuffix(error) {
  return `IMPORTANT: your previous reply was rejected because it was not usable:

${error}

Try again. Output ONLY the single JSON object described above — first character "{", last character "}", with no prose, preamble, apology, or code fences of any kind.`;
}

/**
 * Prompt for generating the initial walkthrough.
 * @param {object} args
 * @param {string} args.question
 */
export function buildGeneratePrompt({ question }) {
  return `${GENERATE_RULES}

Question:
${question}`;
}

/**
 * Prompt for answering a follow-up question about a SPECIFIC step. The agent
 * gets the whole walkthrough for context (so it can reference other steps) but
 * answers only the question — it must NOT rewrite the walkthrough.
 *
 * @param {object} args
 * @param {object} args.walkthrough  The current full walkthrough.
 * @param {object} args.step         The step the reader is currently on.
 * @param {string} args.question     The reader's follow-up.
 */
export function buildQuestionPrompt({ walkthrough, step, question }) {
  // Give the agent a compact map of the other steps (id + heading) so it can
  // cite them in relatedSteps without us shipping the entire payload twice.
  const stepMap = walkthrough.steps
    .map((s) => `  ${s.id}: ${s.heading}`)
    .join('\n');

  return `You are helping a reader who is part-way through a step-by-step walkthrough of a codebase. They are currently reading ONE step and have a follow-up question about it.

Answer their question in plain English, building on what this step already says. You may inspect the codebase with your tools if needed. Your answer must be self-contained and must NOT rewrite or restate the whole walkthrough.

${EXPLANATION_QUALITY_RULES}

Follow-up answer shaping:
- For "how does this work?" questions, explain the flow in order and include a minimal example when it helps.
- For "would we / should we / what pattern?" questions, give a practical recommendation for this codebase, show the current/local pattern, show relevant alternatives, and include pros/cons or tradeoffs.
- For "how would I change this?" questions, name the likely files, sketch the sequence, include pseudo-code or code examples, and mention tests or edge cases.
- For debugging questions, give the likely cause, where to inspect first, and concrete checks before suggesting rewrites.
- Put the main prose in "answer". Use Markdown headings, bullets, simple tables, inline code, and fenced code blocks when they make the answer easier to scan.
- Put standalone examples in "codeExamples" when they deserve their own code block.
- Put option comparisons in "tradeoffs" when the user asks about patterns, alternatives, or architectural choices.
- Put one concise takeaway in "recommendation" when the user asks what to choose or what to do.

If other steps in the walkthrough are relevant to your answer, you may refer to them naturally in the prose AND list their ids in "relatedSteps" so the reader can jump to them.

The walkthrough is titled "${walkthrough.title}". Its steps are:
${stepMap}

The reader is currently on step "${step.id}" — "${step.heading}":
${step.explanation}${step.code ? `\n\nCode shown in this step (${[step.file, step.lines].filter(Boolean).join(' : ')}):\n${step.code}` : ''}

Their follow-up question about this step:
${question}

${JSON_ONLY_RULES}
- The JSON MUST match this shape exactly:

${answerSchemaDescription}`;
}
