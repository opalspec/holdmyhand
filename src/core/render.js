// @hmh/core — renderer. Pure functions: walkthrough/library JSON -> HTML string.
// The local server (CLI) and the plugin's MCP server both wrap these.
// No agent or transport assumptions live here.
//
// Each renderer accepts an optional `templateSource` string. When given (the
// plugin path — the bundle inlines the template so there is no file to read), it
// is used directly; when omitted (the POC CLI path) the template file is read
// from disk. This is the small refactor §2 calls for so the MCP bundle can be
// self-contained.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(here, 'templates', 'walkthrough.html');
const LIBRARY_TEMPLATE_PATH = path.join(here, 'templates', 'library.html');

const WALKTHROUGH_PLACEHOLDER = '__WALKTHROUGH_JSON__';
const META_PLACEHOLDER = '__HMH_META_JSON__';
const LIBRARY_PLACEHOLDER = '__LIBRARY_JSON__';

// Escape `<` so an embedded "</script>" in any string can't break out of the
// inlined <script> tag.
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * @param {object} walkthrough        A validated walkthrough object.
 * @param {object} [opts]
 * @param {string} [opts.templateSource]  Inlined template (plugin path).
 * @param {object} [opts.meta]            Page metadata (token, staleness, urls…).
 * @returns {Promise<string>}          Full HTML document.
 */
export async function render(walkthrough, opts = {}) {
  const { templateSource, meta = {} } = opts;
  const template = templateSource ?? (await readFile(TEMPLATE_PATH, 'utf8'));
  return template
    .replace(WALKTHROUGH_PLACEHOLDER, safeJson(walkthrough))
    .replace(META_PLACEHOLDER, safeJson(meta));
}

/**
 * @param {Array} items                Library entries (header fields per walkthrough).
 * @param {object} [opts]
 * @param {string} [opts.templateSource]
 * @param {object} [opts.meta]
 * @returns {Promise<string>}
 */
export async function renderLibrary(items, opts = {}) {
  const { templateSource, meta = {} } = opts;
  const template = templateSource ?? (await readFile(LIBRARY_TEMPLATE_PATH, 'utf8'));
  return template
    .replace(LIBRARY_PLACEHOLDER, safeJson({ items }))
    .replace(META_PLACEHOLDER, safeJson(meta));
}
