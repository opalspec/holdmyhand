#!/usr/bin/env node
// Hold My Hand — POC CLI entry.
//   hmh "how does the achievements and events system work?"
//   hmh --port 5000 "how does auth work?"

import { loadConfig } from '../src/cli/config.js';
import { createClaudeAdapter } from '../src/adapters/claude.js';
import { createEngine } from '../src/core/engine.js';
import { serve } from '../src/cli/serve.js';

function parseArgs(argv) {
  const opts = { open: true, port: null };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') opts.open = false;
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--help' || a === '-h') opts.help = true;
    else words.push(a);
  }
  opts.question = words.join(' ').trim();
  return opts;
}

const HELP = `Hold My Hand — codebase walkthroughs

Usage:
  hmh [options] "<your question>"

Options:
  --port <n>    Port for the local server (default: 4173 or config.port)
  --no-open     Don't auto-open the browser
  -h, --help    Show this help

Config (hmh.config.json in the current directory):
  { "codebasePath": "C:/path/to/codebase", "model": "<optional>", "port": 4173 }
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || !opts.question) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const config = await loadConfig();
  const adapter = createClaudeAdapter({ model: config.model });
  const engine = createEngine({ adapter, log: (m) => console.log(`   ${m}`) });

  console.log(`\n🤚 Hold My Hand`);
  console.log(`   Codebase: ${config.codebasePath}`);
  console.log(`   Question: ${opts.question}`);
  console.log(`\nInspecting the codebase (this can take a minute)…`);

  const walkthrough = await engine.generate({
    question: opts.question,
    codebasePath: config.codebasePath,
  });
  console.log(`   Built "${walkthrough.title}" — ${walkthrough.steps.length} steps.`);

  await serve({
    engine,
    codebasePath: config.codebasePath,
    walkthrough,
    port: opts.port || config.port || 4173,
    open: opts.open,
  });
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
