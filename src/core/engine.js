// @hmh/core — orchestrator. Wires the prompt builders, an injected agent
// adapter, and schema validation. Knows nothing about Claude, the CLI, or any
// delivery shape: the adapter is passed in.

import { buildGeneratePrompt, buildQuestionPrompt, repairSuffix } from './prompt.js';
import { extractWalkthrough, extractAnswer } from './schema.js';

/**
 * @param {object} deps
 * @param {{ inspect: (args: {prompt: string, codebasePath: string}) => Promise<string> }} deps.adapter
 * @param {(msg: string) => void} [deps.log]
 */
export function createEngine({ adapter, log = () => {} }) {
  if (!adapter || typeof adapter.inspect !== 'function') {
    throw new Error('createEngine requires an adapter with an inspect() method');
  }

  // Run the adapter, parse with `extract`, and retry once (re-sending the full
  // prompt + error) if the first reply isn't valid JSON.
  async function runWithRepair({ prompt, codebasePath, extract }) {
    const raw = await adapter.inspect({ prompt, codebasePath });
    try {
      return extract(raw);
    } catch (err) {
      log(`Output invalid (${err.message}). Asking the agent to repair…`);
      const repaired = await adapter.inspect({
        prompt: `${prompt}\n\n${repairSuffix(err.message)}`,
        codebasePath,
      });
      return extract(repaired);
    }
  }

  /**
   * Generate the initial walkthrough.
   * @param {object} args
   * @param {string} args.question
   * @param {string} args.codebasePath
   */
  async function generate({ question, codebasePath }) {
    const prompt = buildGeneratePrompt({ question });
    return runWithRepair({ prompt, codebasePath, extract: extractWalkthrough });
  }

  /**
   * Answer a follow-up about a specific step. Additive: returns a Q&A entry to
   * append to that step; it never modifies the rest of the walkthrough.
   * @param {object} args
   * @param {object} args.walkthrough
   * @param {object} args.step
   * @param {string} args.question
   * @param {string} args.codebasePath
   * @returns {Promise<{question:string, answer:string, relatedSteps:string[]}>}
   */
  async function answer({ walkthrough, step, question, codebasePath }) {
    const prompt = buildQuestionPrompt({ walkthrough, step, question });
    const result = await runWithRepair({ prompt, codebasePath, extract: extractAnswer });
    // Keep only related step ids that actually exist; drop self-references.
    const validIds = new Set(walkthrough.steps.map((s) => s.id));
    const relatedSteps = (result.relatedSteps || []).filter(
      (id) => validIds.has(id) && id !== step.id,
    );
    return { question, answer: result.answer, relatedSteps };
  }

  return { generate, answer };
}
