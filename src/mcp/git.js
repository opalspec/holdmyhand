// Git metadata helper for the MCP server (a WRAPPER concern — the agnostic core
// never touches git). Stamps a walkthrough with the commit + working-tree state
// it was built against, and later detects staleness on restore (§4, finding #3).
//
// Everything degrades gracefully: in a non-git codebase every value is null and
// staleness falls back to "timestamp only" (the server shows "built N days ago").

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

// Run a git subcommand in `cwd`; resolve trimmed stdout, or null on any failure
// (not a repo, git missing, non-zero exit). Never throws.
function git(args, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, { cwd, shell: false, windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? out.trim() : null));
  });
}

/**
 * Current commit + working-tree fingerprint of `repoDir`.
 * @returns {Promise<{ sha: string|null, dirtyHash: string|null }>}
 */
export async function gitMeta(repoDir) {
  const sha = await git(['rev-parse', 'HEAD'], repoDir);
  if (sha === null) return { sha: null, dirtyHash: null };
  // Tracked changes vs HEAD + the list of untracked files = a fingerprint of
  // every uncommitted edit. Hash it so we can cheaply compare later.
  const diff = (await git(['diff', 'HEAD'], repoDir)) ?? '';
  const untracked = (await git(['ls-files', '--others', '--exclude-standard'], repoDir)) ?? '';
  const dirtyHash = createHash('sha256').update(diff).update('\0').update(untracked).digest('hex');
  return { sha, dirtyHash };
}

/**
 * Is a saved walkthrough stale vs the live repo? Stale when HEAD moved OR the
 * working tree changed since it was built (so uncommitted edits count too).
 * @returns {Promise<{ stale: boolean, dirtyChanged: boolean, isGit: boolean, currentSha: string|null }>}
 */
export async function staleness(repoDir, builtAtSha, builtAtDirtyHash) {
  const { sha, dirtyHash } = await gitMeta(repoDir);
  if (sha === null) {
    // Not a git repo (or git unavailable): can't compare commits.
    return { stale: false, dirtyChanged: false, isGit: false, currentSha: null };
  }
  const shaMoved = builtAtSha != null && builtAtSha !== sha;
  const dirtyChanged = builtAtDirtyHash != null && builtAtDirtyHash !== dirtyHash;
  return { stale: shaMoved || dirtyChanged, dirtyChanged, isGit: true, currentSha: sha };
}
