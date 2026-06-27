// Local web server for the POC. Serves the rendered walkthrough and exposes the
// follow-up endpoint that brings the agent into the page (M2 interactivity).
// It wraps the pure core renderer + engine; it owns no walkthrough logic itself.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { render } from '../core/render.js';

/**
 * @param {object} args
 * @param {{ generate: Function }} args.engine
 * @param {string} args.codebasePath
 * @param {object} args.walkthrough  Initial walkthrough to serve.
 * @param {number} [args.port]
 * @param {boolean} [args.open]
 */
export async function serve({ engine, codebasePath, walkthrough, port = 4173, open = true }) {
  let current = walkthrough; // mutable source of truth across follow-ups

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        const html = await render(current);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (req.method === 'GET' && req.url === '/api/walkthrough') {
        sendJson(res, 200, current);
        return;
      }

      if (req.method === 'POST' && req.url === '/api/ask') {
        const body = await readBody(req);
        const question = (body.question || '').trim();
        const stepId = body.stepId;
        if (!question) {
          sendJson(res, 400, { error: 'Missing "question".' });
          return;
        }
        const step = current.steps.find((s) => s.id === stepId);
        if (!step) {
          sendJson(res, 400, { error: `Unknown stepId: ${stepId}` });
          return;
        }
        console.log(`  ↳ follow-up on ${stepId}: ${question}`);
        const entry = await engine.answer({ walkthrough: current, step, question, codebasePath });
        // Additive: append the Q&A to the step; never touch anything else.
        (step.qa ??= []).push(entry);
        sendJson(res, 200, { stepId, entry });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      console.error('Request failed:', err.message);
      sendJson(res, 500, { error: err.message });
    }
  });

  await listen(server, port);
  const url = `http://localhost:${port}`;
  console.log(`\n✅ Walkthrough ready at ${url}`);
  console.log('   Use ← / → or the buttons to navigate; ask a follow-up at the bottom.');
  console.log('   Press Ctrl+C to stop.\n');
  if (open) openBrowser(url);

  return server;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Try --port <n>.`));
      } else {
        reject(err);
      }
    });
    server.listen(port, resolve);
  });
}

function openBrowser(url) {
  const cmd =
    process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open'
    : 'xdg-open';
  try {
    // `start` is a cmd builtin; the empty "" is its title argument.
    const args = process.platform === 'win32' ? ['', url] : [url];
    spawn(cmd, args, { shell: true, stdio: 'ignore', detached: true }).unref();
  } catch {
    /* non-fatal: the URL is printed above */
  }
}
