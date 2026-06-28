// End-to-end smoke test (P2.7). No external services; no browser (HMH_NO_OPEN).
//   1. core/persist.js directly: save → list → load → appendQa → self-ignore.
//   2. the BUILT bundle over MCP stdio: initialize → tools/list →
//      render_walkthrough (with a real excerpt → source-verify) → HTTP fetch with
//      the token (and a 403 without it) → list_walkthroughs.
//
// Run: npm run smoke

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUNDLE = path.join(root, 'plugins', 'hold-my-hand', 'dist', 'hmh-mcp.mjs');

let passed = 0;
const ok = (m) => { passed++; process.stdout.write(`  ✓ ${m}\n`); };

// ── 1. persist core ─────────────────────────────────────────────────────────
async function testSchemas() {
  process.stdout.write('schemas:\n');
  const { extractAnswer } = await import('../src/core/schema.js');
  const parsed = extractAnswer(JSON.stringify({
    answer: 'Use `AppScopes` for the local pattern, then consider a package if it grows.',
    recommendation: 'Keep distinct concerns in distinct scopes.',
    codeExamples: [{
      title: 'Pseudo-code',
      language: 'dart',
      code: 'AppScopes(child: MyApp())',
      caption: 'A flattened wrapper around several scopes.',
    }],
    tradeoffs: [{
      option: 'MultiProvider',
      pros: ['Flattens provider nesting'],
      cons: ['Adds a dependency'],
      bestWhen: 'There are several independent ChangeNotifiers.',
    }],
    relatedSteps: ['step-2'],
  }));
  assert.equal(parsed.codeExamples.length, 1);
  assert.equal(parsed.tradeoffs.length, 1);
  assert.equal(parsed.recommendation.includes('distinct'), true);
  ok('structured follow-up answers validate');
}

async function testPersist() {
  process.stdout.write('persist core:\n');
  const dir = await mkdtemp(path.join(tmpdir(), 'hmh-persist-'));
  const { createStore } = await import('../src/core/persist.js');
  const store = createStore({ baseDir: dir });

  const saved = await store.save({
    question: 'How does Auth/work? (weird:chars)',
    title: 'Auth', summary: 's',
    steps: [{ heading: 'h', explanation: 'e' }],
  });
  assert.ok(saved.id, 'save stamps an id');
  assert.equal(saved.schemaVersion, '1', 'save stamps schemaVersion');
  assert.ok(saved.steps[0].id === 'step-1', 'step id filled');
  ok('save() stamps id/slug/schemaVersion and fills step ids');

  const files = await readdir(dir);
  assert.ok(files.includes('.gitignore'), 'self-ignore written');
  assert.equal((await readFile(path.join(dir, '.gitignore'), 'utf8')).includes('*'), true);
  const jsonFile = files.find((f) => f.endsWith('.json'));
  assert.ok(/^[a-z0-9-]+\.json$/.test(jsonFile), `safe filename: ${jsonFile}`);
  ok(`self-ignoring .gitignore + windows-safe filename (${jsonFile})`);

  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].stepCount, 1);
  ok('list() scans the folder');

  // concurrent appendQa must not lose entries (per-id queue)
  await Promise.all([
    store.appendQa(saved.id, 'step-1', { question: 'q1', answer: 'a1' }),
    store.appendQa(saved.id, 'step-1', { question: 'q2', answer: 'a2' }),
    store.appendQa(saved.id, 'step-1', { question: 'q3', answer: 'a3' }),
  ]);
  const reloaded = await store.load(saved.id);
  assert.equal(reloaded.steps[0].qa.length, 3, 'all 3 concurrent Q&A persisted');
  assert.ok(reloaded.steps[0].qa.every((e) => e.askedAt), 'qa entries stamped with askedAt');
  ok('appendQa() serializes concurrent writes (no lost answers)');

  await rm(dir, { recursive: true, force: true });
}

// ── minimal MCP-over-stdio client ───────────────────────────────────────────
function mcpClient(child) {
  let buf = '';
  const pending = new Map();
  let nextId = 1;
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; } // ignore non-JSON on stdout
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  return { rpc, notify };
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

// ── 2. bundle over MCP stdio ────────────────────────────────────────────────
async function testServer() {
  process.stdout.write('built MCP server:\n');
  const codebase = await mkdtemp(path.join(tmpdir(), 'hmh-repo-'));
  // A real source file with a verbatim excerpt for source-verify.
  await mkdir(path.join(codebase, 'src'), { recursive: true });
  const sample = ['export function add(a, b) {', '  return a + b;', '}', ''].join('\n');
  await writeFile(path.join(codebase, 'src', 'math.js'), sample, 'utf8');

  // Per-project port override via .hmh/config.json (no HMH_PORT env set).
  const CONFIG_PORT = 7390;
  await mkdir(path.join(codebase, '.hmh'), { recursive: true });
  await writeFile(path.join(codebase, '.hmh', 'config.json'), JSON.stringify({ port: CONFIG_PORT }), 'utf8');

  const child = spawn('node', [BUNDLE], {
    env: { ...process.env, HMH_CODEBASE: codebase, HMH_NO_OPEN: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {}); // server logs to stderr; keep it quiet

  try {
    const client = mcpClient(child);
    const init = await client.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0' },
    });
    assert.ok(init.result, 'initialize ok');
    client.notify('notifications/initialized', {});
    ok('initialize handshake');

    const tools = await client.rpc('tools/list', {});
    const names = tools.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['list_walkthroughs', 'open_library', 'open_walkthrough', 'render_walkthrough']);
    ok('tools/list exposes all four tools');

    // render with a WRONG excerpt → source-verify must reject.
    const bad = await client.rpc('tools/call', {
      name: 'render_walkthrough',
      arguments: { walkthrough: {
        question: 'how does add work', title: 'Add', summary: 'sum',
        steps: [{ heading: 'add', explanation: 'adds', code: 'return a - b;', file: 'src/math.js' }],
      } },
    });
    assert.equal(bad.result.isError, true, 'wrong excerpt rejected');
    assert.match(bad.result.content[0].text, /not found/i);
    ok('render_walkthrough rejects an unverifiable excerpt (source-verify)');

    // render with the REAL excerpt → success, lines auto-filled.
    const good = await client.rpc('tools/call', {
      name: 'render_walkthrough',
      arguments: { walkthrough: {
        question: 'how does add work', title: 'Add', summary: 'sum',
        steps: [{ heading: 'add', explanation: 'adds', code: 'return a + b;', file: 'src/math.js' }],
      } },
    });
    assert.notEqual(good.result.isError, true, 'valid walkthrough accepted');
    const out = JSON.parse(good.result.content[0].text);
    assert.ok(out.url && out.id, 'returns { url, id }');
    ok(`render_walkthrough persists + serves (${out.url})`);

    assert.match(out.url, new RegExp(`:${CONFIG_PORT}$`), `.hmh/config.json port honored (${CONFIG_PORT})`);
    ok(`.hmh/config.json "port" override honored (${CONFIG_PORT})`);

    // .hmh file written into the codebase
    const hmhFiles = await readdir(path.join(codebase, '.hmh'));
    assert.ok(hmhFiles.some((f) => f.endsWith('.json')), '.hmh json written');
    assert.ok(hmhFiles.includes('.gitignore'), 'self-ignore in .hmh');
    ok('walkthrough persisted under <codebase>/.hmh');

    // HTTP: the page loads, the excerpt line range was auto-corrected to 2-2.
    const page = await httpGet(out.url);
    assert.equal(page.status, 200);
    assert.match(page.body, /Hold My Hand/);
    assert.match(page.body, /"lines":"2-2"/, 'line range auto-corrected to 2-2');
    ok('HTTP page serves with auto-corrected line range');

    // §3.6 auth: /api/* is 403 without the token.
    const noTok = await httpGet(`${out.url}/api/walkthrough`);
    assert.equal(noTok.status, 403, 'token required');
    ok('/api/* rejects requests without the token (403)');

    const lib = await client.rpc('tools/call', { name: 'list_walkthroughs', arguments: {} });
    const listed = JSON.parse(lib.result.content[0].text).walkthroughs;
    assert.equal(listed.length, 1);
    ok('list_walkthroughs returns the saved entry');
  } finally {
    child.kill();
    await rm(codebase, { recursive: true, force: true }).catch(() => {});
  }
}

await testSchemas();
await testPersist();
await testServer();
process.stdout.write(`\nAll ${passed} smoke checks passed.\n`);
