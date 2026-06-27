// Hold My Hand — bundled MCP server (Phase 2).
//
// One process, two interfaces (§3.4):
//   • MCP over STDIO — tools the in-session agent calls (render_walkthrough,
//     list_walkthroughs, open_walkthrough, open_library).
//   • A loopback HTTP server — serves the walkthrough/library pages and answers
//     page follow-ups via `claude -p`.
//
// Hard rules:
//   • STDOUT is reserved for MCP messages only (§3.7). ALL logging goes to stderr
//     (and best-effort to .hmh/logs). Never console.log here.
//   • The HTTP server binds 127.0.0.1 only, mints a per-server token, gates every
//     /api/* call on it, sends no permissive CORS, and rate-limits /api/ask (§3.6).
//   • In child mode (HMH_CHILD_CLAUDE=1) the server boots INERT: no HTTP, no
//     browser, no persistence — so a follow-up's nested claude can't recurse (§3.5).
//
// The HTML templates are inlined at build time (esbuild `text` loader) so the
// committed bundle is self-contained and runs with no npm install.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { walkthroughSchema } from '../core/schema.js';
import { render, renderLibrary } from '../core/render.js';
import { createStore } from '../core/persist.js';
import { createClaudeAdapter } from '../adapters/claude.js';
import { createEngine } from '../core/engine.js';
import { gitMeta, staleness } from './git.js';

// These two imports are resolved by esbuild's `text` loader into inlined strings
// in the bundle. In dev (running src directly) they would fail, so the bundle is
// the supported run target; see build.mjs.
import WALKTHROUGH_TEMPLATE from '../core/templates/walkthrough.html';
import LIBRARY_TEMPLATE from '../core/templates/library.html';

// ── environment ─────────────────────────────────────────────────────────────
const CODEBASE = process.env.HMH_CODEBASE || process.cwd();
const IS_CHILD = process.env.HMH_CHILD_CLAUDE === '1';
const HMH_DIR = path.join(CODEBASE, '.hmh');
const PREFERRED_PORT = Number(process.env.HMH_PORT) || 7345;
const TOKEN = randomBytes(24).toString('hex');

const store = createStore({ baseDir: HMH_DIR });

// ── logging (stderr + best-effort file; NEVER stdout) ───────────────────────
async function log(msg) {
  const line = `[hmh ${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(line);
  if (IS_CHILD) return;
  try {
    await mkdir(path.join(HMH_DIR, 'logs'), { recursive: true });
    await appendFile(path.join(HMH_DIR, 'logs', 'server.log'), line, 'utf8');
  } catch { /* logging must never throw */ }
}

// ── in-memory current walkthrough (the page's source of truth) ──────────────
let current = null;

// ── HTTP server (lazy) ──────────────────────────────────────────────────────
let httpState = null; // { server, port, url }
let askInFlight = false;
let lastAskEndedAt = 0;
const ASK_COOLDOWN_MS = 1500;

function humanAge(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!then) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

async function buildMeta(walkthrough) {
  const meta = {
    token: TOKEN,
    libraryUrl: '/library',
    regenerateHint: walkthrough?.question ? `/hold-my-hand:explain ${walkthrough.question}` : null,
  };
  if (walkthrough) {
    const s = await staleness(CODEBASE, walkthrough.builtAtSha, walkthrough.builtAtDirtyHash);
    meta.stale = s.stale;
    meta.dirtyChanged = s.dirtyChanged;
    meta.builtAtSha = walkthrough.builtAtSha ?? null;
    meta.builtAt = humanAge(walkthrough.createdAt);
  }
  return meta;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1_000_000) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// §3.6 auth: token in X-HMH-Token header or ?t=; require JSON content-type on POST.
function authed(req, url) {
  const headerTok = req.headers['x-hmh-token'];
  const queryTok = url.searchParams.get('t');
  if (headerTok !== TOKEN && queryTok !== TOKEN) return false;
  if (req.method === 'POST') {
    const ct = String(req.headers['content-type'] || '');
    if (!ct.includes('application/json')) return false;
  }
  return true;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  // ── pages (HTML, no token needed to bootstrap; token is embedded inside) ──
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    if (!current) { res.writeHead(302, { Location: '/library' }); res.end(); return; }
    const html = await render(current, { templateSource: WALKTHROUGH_TEMPLATE, meta: await buildMeta(current) });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && pathname === '/library') {
    const items = await store.list();
    const html = await renderLibrary(items, { templateSource: LIBRARY_TEMPLATE, meta: { token: TOKEN } });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── API (all token-gated) ────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    if (!authed(req, url)) { sendJson(res, 403, { error: 'Forbidden' }); return; }

    if (req.method === 'GET' && pathname === '/api/walkthrough') {
      if (!current) { sendJson(res, 404, { error: 'No current walkthrough' }); return; }
      const m = await buildMeta(current);
      sendJson(res, 200, { ...current, stale: m.stale, builtAtSha: m.builtAtSha, builtAt: m.builtAt, dirtyChanged: m.dirtyChanged });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/open') {
      const body = await readBody(req);
      const loaded = await store.load(String(body.id || ''));
      if (!loaded) { sendJson(res, 404, { error: `Unknown id: ${body.id}` }); return; }
      current = loaded;
      sendJson(res, 200, { ok: true, id: loaded.id });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/regenerate') {
      sendJson(res, 200, {
        hint: current?.question ? `/hold-my-hand:explain ${current.question}` : '/hold-my-hand:explain <your question>',
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/ask') {
      // Rate limit: one in-flight + a short cooldown so a stray page can't spam
      // nested claude runs (§3.6).
      if (askInFlight) { sendJson(res, 429, { error: 'A question is already being answered. Please wait.' }); return; }
      if (Date.now() - lastAskEndedAt < ASK_COOLDOWN_MS) { sendJson(res, 429, { error: 'Please wait a moment before asking again.' }); return; }

      const body = await readBody(req);
      const question = String(body.question || '').trim();
      const stepId = body.stepId;
      if (!question) { sendJson(res, 400, { error: 'Missing "question".' }); return; }
      if (!current) { sendJson(res, 400, { error: 'No current walkthrough.' }); return; }
      const step = current.steps.find((s) => s.id === stepId);
      if (!step) { sendJson(res, 400, { error: `Unknown stepId: ${stepId}` }); return; }

      askInFlight = true;
      try {
        await log(`follow-up on ${stepId}: ${question}`);
        const entry = await engine.answer({ walkthrough: current, step, question, codebasePath: CODEBASE });
        const stamped = await store.appendQa(current.id, stepId, entry); // persisted + stamped
        (step.qa ??= []).push(stamped); // keep in-memory current in sync
        sendJson(res, 200, { stepId, entry: stamped });
      } catch (err) {
        await log(`follow-up failed: ${err.message}`);
        sendJson(res, 500, { error: err.message });
      } finally {
        askInFlight = false;
        lastAskEndedAt = Date.now();
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// Bind 127.0.0.1 with a free-port fallback (§3.4).
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onErr = (err) => { server.removeListener('listening', onOk); reject(err); };
    const onOk = () => { server.removeListener('error', onErr); resolve(); };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(port, '127.0.0.1');
  });
}

async function ensureHttp() {
  if (httpState) return httpState;
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      log(`request error: ${err.message}`);
      try { sendJson(res, 500, { error: err.message }); } catch { /* headers sent */ }
    });
  });
  let port = PREFERRED_PORT;
  for (let i = 0; i < 25; i++) {
    try {
      await listen(server, port);
      httpState = { server, port, url: `http://127.0.0.1:${port}` };
      await log(`http listening on ${httpState.url}`);
      return httpState;
    } catch (err) {
      if (err.code === 'EADDRINUSE') { port += 1; continue; }
      throw err;
    }
  }
  throw new Error('Could not find a free port for the HMH server.');
}

function openBrowser(url) {
  if (IS_CHILD) return; // never open a browser from a nested run
  if (process.env.HMH_NO_OPEN === '1') return; // headless / test mode (finding I3)
  const cmd = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const args = process.platform === 'win32' ? ['', url] : [url];
    spawn(cmd, args, { shell: true, stdio: 'ignore', detached: true }).unref();
  } catch { /* best-effort: the URL is returned to the agent anyway (finding I3) */ }
}

// ── source verification (finding I1) ────────────────────────────────────────
const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();

// Locate a multi-line snippet in a file by matching whitespace-normalized lines.
// Returns { startLine, endLine } (1-based) or null.
function locateSnippet(fileText, code) {
  const fileLines = fileText.split(/\r?\n/).map((l) => l.trim().replace(/\s+/g, ' '));
  let codeLines = code.split(/\r?\n/).map((l) => l.trim().replace(/\s+/g, ' '));
  while (codeLines.length && codeLines[0] === '') codeLines.shift();
  while (codeLines.length && codeLines[codeLines.length - 1] === '') codeLines.pop();
  if (!codeLines.length) return null;
  for (let i = 0; i + codeLines.length <= fileLines.length; i++) {
    let ok = true;
    for (let j = 0; j < codeLines.length; j++) {
      if (fileLines[i + j] !== codeLines[j]) { ok = false; break; }
    }
    if (ok) return { startLine: i + 1, endLine: i + codeLines.length };
  }
  return null;
}

// Verify every excerpt against the real files; auto-correct line ranges where we
// can, or return precise per-step errors for the agent to fix. Mutates `lines`.
async function verifyExcerpts(walkthrough) {
  const errors = [];
  for (let i = 0; i < walkthrough.steps.length; i++) {
    const step = walkthrough.steps[i];
    if (!step.file || !step.code) continue;
    const abs = path.resolve(CODEBASE, step.file);
    const rel = path.relative(CODEBASE, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      errors.push(`step ${i + 1} ("${step.heading}"): file "${step.file}" is outside the repository.`);
      continue;
    }
    let text;
    try {
      text = await readFile(abs, 'utf8');
    } catch {
      errors.push(`step ${i + 1} ("${step.heading}"): file "${step.file}" does not exist. Use a real path from the repo, or drop the code excerpt.`);
      continue;
    }
    const loc = locateSnippet(text, step.code);
    if (loc) {
      step.lines = `${loc.startLine}-${loc.endLine}`; // auto-correct to where it really is
      continue;
    }
    if (collapse(text).includes(collapse(step.code))) {
      continue; // a fragment within a line — present, just not a clean line range
    }
    errors.push(`step ${i + 1} ("${step.heading}"): the code excerpt was not found in "${step.file}". Quote the real code verbatim (copy it), or remove the excerpt if you're paraphrasing.`);
  }
  return errors;
}

// ── MCP tools ───────────────────────────────────────────────────────────────
const mcp = new McpServer({ name: 'hmh', version: '0.1.0' });

function textResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}
function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

if (IS_CHILD) {
  // Inert mode (§3.5): register the tools so the protocol is well-formed, but
  // every call refuses — no HTTP, no browser, no persistence side effects.
  const inert = async () => errorResult('Hold My Hand is running in child mode and is inactive for this nested run.');
  mcp.registerTool('render_walkthrough', { description: 'Inactive in child mode.', inputSchema: { walkthrough: z.object({}).passthrough() } }, inert);
  mcp.registerTool('list_walkthroughs', { description: 'Inactive in child mode.', inputSchema: {} }, inert);
  mcp.registerTool('open_walkthrough', { description: 'Inactive in child mode.', inputSchema: { id: z.string() } }, inert);
  mcp.registerTool('open_library', { description: 'Inactive in child mode.', inputSchema: {} }, inert);
} else {
  const adapter = createClaudeAdapter({ childGuard: true });
  var engine = createEngine({ adapter, log: (m) => log(m) });

  mcp.registerTool(
    'render_walkthrough',
    {
      title: 'Render walkthrough',
      description:
        'Validate, source-verify, persist, serve, and open a walkthrough you have built. ' +
        'Returns { url, id }. On a validation or source-verification failure it returns the ' +
        'specific problems as text — fix them and call again.',
      inputSchema: { walkthrough: z.object({}).passthrough() },
    },
    async ({ walkthrough }) => {
      // 1) Strict schema validation (limits + relative-path file etc.).
      const parsed = walkthroughSchema.safeParse(walkthrough);
      if (!parsed.success) {
        const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
        return errorResult(`The walkthrough failed validation. Fix these and call render_walkthrough again:\n${lines.join('\n')}`);
      }
      const wt = parsed.data;
      wt.steps.forEach((s, i) => { if (!s.id) s.id = `step-${i + 1}`; });

      // 2) Source-verify each excerpt; auto-correct line ranges (finding I1).
      const problems = await verifyExcerpts(wt);
      if (problems.length) {
        return errorResult(`Some code excerpts could not be verified against the real files. Fix these and call render_walkthrough again:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
      }

      // 3) Stamp git provenance, then persist atomically.
      const { sha, dirtyHash } = await gitMeta(CODEBASE);
      wt.builtAtSha = sha;
      wt.builtAtDirtyHash = dirtyHash;
      const saved = await store.save(wt);
      current = saved;

      // 4) Serve + best-effort open (never fail the call — finding I3).
      const { url } = await ensureHttp();
      openBrowser(url);
      await log(`rendered "${saved.title}" (${saved.steps.length} steps) id=${saved.id}`);
      return textResult({ url, id: saved.id });
    },
  );

  mcp.registerTool(
    'list_walkthroughs',
    { title: 'List walkthroughs', description: 'List saved walkthroughs (scan of .hmh).', inputSchema: {} },
    async () => textResult({ walkthroughs: await store.list() }),
  );

  mcp.registerTool(
    'open_walkthrough',
    { title: 'Open walkthrough', description: 'Restore a saved walkthrough by id and serve it. Returns { url, stale, builtAtSha }.', inputSchema: { id: z.string() } },
    async ({ id }) => {
      const loaded = await store.load(id);
      if (!loaded) return errorResult(`No saved walkthrough with id "${id}".`);
      current = loaded;
      const { url } = await ensureHttp();
      openBrowser(url);
      const s = await staleness(CODEBASE, loaded.builtAtSha, loaded.builtAtDirtyHash);
      return textResult({ url, stale: s.stale, builtAtSha: loaded.builtAtSha });
    },
  );

  mcp.registerTool(
    'open_library',
    { title: 'Open library', description: 'Open the saved-walkthroughs library page. Returns { url }.', inputSchema: {} },
    async () => {
      const { url } = await ensureHttp();
      openBrowser(`${url}/library`);
      return textResult({ url: `${url}/library` });
    },
  );
}

// ── boot ────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  await log(IS_CHILD ? 'started in child/inert mode' : `started (codebase=${CODEBASE})`);
}

main().catch((err) => {
  process.stderr.write(`[hmh] fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
