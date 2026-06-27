// @hmh/core — persistence (§4). Agnostic: it knows a base directory and the
// walkthrough shape, nothing about git, Claude, HTTP, or plugins. The MCP server
// (and optionally the POC CLI) wrap it.
//
// Design (revised §4):
//   • Filesystem is the single source of truth — list() SCANS the folder; there
//     is no index file to drift.
//   • Atomic writes — write to a UNIQUE temp name, then rename() over the final
//     file (atomic on every OS; a unique temp means concurrent writers can't
//     clobber each other's temp — finding #4).
//   • appendQa is serialized through an in-process per-id queue and re-reads the
//     file inside the critical section, so additive Q&A is never lost.
//   • load() is lenient/migrating, keyed on schemaVersion, so older files always
//     open as the schema evolves.

import { readFile, writeFile, rename, readdir, mkdir, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { FILE_SCHEMA_VERSION, LIMITS } from './schema.js';

/**
 * @param {object} opts
 * @param {string} opts.baseDir  The `.hmh/` directory (already inside the target repo).
 */
export function createStore({ baseDir }) {
  // Per-id promise chain: serializes writes to the same walkthrough in-process.
  const queues = new Map();

  function enqueue(id, task) {
    const prev = queues.get(id) || Promise.resolve();
    const next = prev.then(task, task); // run regardless of a prior failure
    // Keep the chain from leaking once it settles and nothing else is queued.
    queues.set(id, next);
    next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
    return next;
  }

  async function ensureDir() {
    await mkdir(baseDir, { recursive: true });
  }

  // Self-ignoring folder: `.hmh/.gitignore` = "*" so the whole folder is ignored
  // without ever touching the user's tracked root .gitignore (§4).
  async function ensureSelfIgnore() {
    await ensureDir();
    const gi = path.join(baseDir, '.gitignore');
    try {
      await access(gi);
    } catch {
      await writeFile(gi, '# Hold My Hand local data — self-ignoring folder.\n*\n', 'utf8');
    }
  }

  // Atomic write: unique temp (id + pid + random) → rename over the final path.
  async function atomicWrite(finalPath, contents) {
    await ensureDir();
    const tmp = `${finalPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, contents, 'utf8');
    await rename(tmp, finalPath);
  }

  function fileName(walkthrough) {
    const slug = sanitizeSlug(walkthrough.slug || slugify(walkthrough.question || walkthrough.title));
    return `${slug}-${walkthrough.id}.json`;
  }

  // Resolve the on-disk path for an id by scanning for `*-<id>.json`.
  async function pathForId(id) {
    let names;
    try {
      names = await readdir(baseDir);
    } catch {
      return null;
    }
    const suffix = `-${id}.json`;
    const match = names.find((n) => n.endsWith(suffix)) || names.find((n) => n === `${id}.json`);
    return match ? path.join(baseDir, match) : null;
  }

  /**
   * Persist a walkthrough. Stamps id/slug/schemaVersion/createdAt/updatedAt
   * (git stamps are added by the caller before save). Returns the stored object.
   */
  async function save(walkthrough) {
    const now = new Date().toISOString();
    const stored = {
      ...walkthrough,
      id: walkthrough.id || generateId(),
      schemaVersion: FILE_SCHEMA_VERSION,
      createdAt: walkthrough.createdAt || now,
      updatedAt: now,
    };
    stored.slug = sanitizeSlug(stored.slug || slugify(stored.question || stored.title));
    // Defensive: ensure every step has a stable id even if a caller didn't.
    stored.steps = (stored.steps || []).map((s, i) => ({ ...s, id: s.id || `step-${i + 1}` }));
    await ensureSelfIgnore();
    const finalPath = path.join(baseDir, fileName(stored));
    // Serialize against concurrent appendQa for the same id.
    await enqueue(stored.id, () => atomicWrite(finalPath, JSON.stringify(stored, null, 2)));
    return stored;
  }

  /**
   * Append a Q&A entry to a step. Serialized per-id and re-read inside the
   * critical section so concurrent appends (several browser tabs → one server)
   * never lose an answer. Returns the appended entry (with `askedAt` stamped).
   */
  async function appendQa(id, stepId, entry) {
    return enqueue(id, async () => {
      const filePath = await pathForId(id);
      if (!filePath) throw new Error(`No saved walkthrough with id "${id}".`);
      const fresh = migrate(JSON.parse(await readFile(filePath, 'utf8')));
      const step = (fresh.steps || []).find((s) => s.id === stepId);
      if (!step) throw new Error(`Walkthrough "${id}" has no step "${stepId}".`);
      const stamped = { askedAt: new Date().toISOString(), ...entry };
      (step.qa ??= []).push(stamped);
      fresh.updatedAt = new Date().toISOString();
      await atomicWrite(filePath, JSON.stringify(fresh, null, 2));
      return stamped;
    });
  }

  /** Load one walkthrough by id (lenient/migrating). Returns null if absent. */
  async function load(id) {
    const filePath = await pathForId(id);
    if (!filePath) return null;
    return migrate(JSON.parse(await readFile(filePath, 'utf8')));
  }

  /**
   * Scan the folder and return header fields for each saved walkthrough, newest
   * first. The filesystem is the single source of truth — a file's existence IS
   * its listing, so nothing can drift.
   */
  async function list() {
    let names;
    try {
      names = await readdir(baseDir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const w = migrate(JSON.parse(await readFile(path.join(baseDir, name), 'utf8')));
        out.push({
          id: w.id,
          slug: w.slug,
          title: w.title,
          question: w.question,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
          stepCount: Array.isArray(w.steps) ? w.steps.length : 0,
          builtAtSha: w.builtAtSha ?? null,
        });
      } catch {
        // Skip unreadable/partial files rather than failing the whole listing.
      }
    }
    out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return out;
  }

  return { save, appendQa, load, list, ensureSelfIgnore, pathForId };
}

// ── pure helpers (exported for reuse/testing) ───────────────────────────────

export function generateId() {
  return Date.now().toString(36) + '-' + randomBytes(3).toString('hex');
}

/** Human-readable slug from free text (before length/charset sanitizing). */
export function slugify(text) {
  return String(text || 'walkthrough')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Windows-safe, length-capped filename slug (finding I2): lowercase [a-z0-9-]
 * only, no reserved chars, no trailing dot/space, capped length. Always returns
 * a non-empty string.
 */
export function sanitizeSlug(slug) {
  let s = String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.maxSlug)
    .replace(/-+$/g, '');
  return s || 'walkthrough';
}

/**
 * Lenient/migrating load (§4): bring an on-disk object up to the current shape
 * without hard-failing on missing optional fields or an unknown schemaVersion.
 * Kept deliberately forgiving — readers should always open.
 */
export function migrate(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('Saved walkthrough is not an object.');
  }
  const w = { ...obj };
  if (!Array.isArray(w.steps)) w.steps = [];
  w.steps = w.steps.map((s, i) => ({ ...s, id: s.id || `step-${i + 1}` }));
  if (w.builtAtSha === undefined) w.builtAtSha = null;
  if (w.builtAtDirtyHash === undefined) w.builtAtDirtyHash = null;
  // Future schemaVersion bumps branch here on w.schemaVersion.
  return w;
}
