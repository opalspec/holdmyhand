// POC-only config loader. Holds the path to the target codebase (and optional
// agent/server options). This scaffold disappears in the plugin phase, where the
// agent already runs inside the target repo.
//
// `hmh.config.local.json` (gitignored) overrides `hmh.config.json` for
// machine-specific paths.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Could not read ${path.basename(file)}: ${err.message}`);
  }
}

export async function loadConfig(cwd = process.cwd()) {
  const base = await readJsonIfExists(path.join(cwd, 'hmh.config.json'));
  const local = await readJsonIfExists(path.join(cwd, 'hmh.config.local.json'));

  if (!base && !local) {
    throw new Error(
      'No hmh.config.json found. Create one with: { "codebasePath": "C:/path/to/your/codebase" }',
    );
  }

  const config = { ...(base || {}), ...(local || {}) };

  if (!config.codebasePath) {
    throw new Error('hmh.config.json is missing "codebasePath".');
  }
  config.codebasePath = path.resolve(cwd, config.codebasePath);

  let info;
  try {
    info = await stat(config.codebasePath);
  } catch {
    throw new Error(`codebasePath does not exist: ${config.codebasePath}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`codebasePath is not a directory: ${config.codebasePath}`);
  }

  return config;
}
