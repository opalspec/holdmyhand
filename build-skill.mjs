// Regenerate the schema block inside the `explain` skill from core (P2.3 drift
// guard). The skill tells the agent exactly what JSON to produce; deriving that
// block from core/schema.js's `schemaDescription` means the skill and the
// validator can never diverge. Run by `npm run build:skill` (and build:plugin).

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { schemaDescription, LIMITS } from './src/core/schema.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const skillPath = path.join(root, 'plugins', 'hold-my-hand', 'skills', 'explain', 'SKILL.md');

const START = '<!-- HMH:SCHEMA:START -->';
const END = '<!-- HMH:SCHEMA:END -->';

const block = [
  START,
  '<!-- GENERATED from src/core/schema.js by build-skill.mjs — do not edit by hand. -->',
  '',
  'Produce a single JSON object in exactly this shape:',
  '',
  '```json',
  schemaDescription,
  '```',
  '',
  'Limits (the render tool enforces these — stay within them):',
  `- At most ${LIMITS.maxSteps} steps.`,
  `- \`file\` must be a path **relative to the repo root** (no absolute paths, no \`..\`).`,
  `- Keep each \`code\` excerpt and \`explanation\` focused (hard caps ~${LIMITS.maxCode} chars).`,
  '- Quote real code **verbatim** so the render tool can locate it; if you are paraphrasing, omit `code`.',
  END,
].join('\n');

const md = await readFile(skillPath, 'utf8');
const re = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!re.test(md)) {
  process.stderr.write(`✗ no ${START} … ${END} markers found in ${path.relative(root, skillPath)}\n`);
  process.exit(1);
}
await writeFile(skillPath, md.replace(re, block), 'utf8');
process.stderr.write(`✓ synced schema block into ${path.relative(root, skillPath)}\n`);
