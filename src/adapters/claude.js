// Agent adapter — Claude Code CLI in headless print mode.
//
// Contract (the seam that keeps the core agent-agnostic):
//   inspect({ prompt, codebasePath }) -> Promise<string rawText>
//
// We run `claude -p` with cwd = the target codebase so the agent inspects the
// real files with its own Read/Grep/Glob tools, and `--output-format json` so we
// get a parseable envelope. The prompt is passed on stdin to avoid shell quoting
// issues with long, multi-line prompts.

import { spawn } from 'node:child_process';

const DEFAULT_ALLOWED_TOOLS = 'Read,Grep,Glob';

export function createClaudeAdapter(options = {}) {
  const {
    allowedTools = DEFAULT_ALLOWED_TOOLS,
    model = null,
    maxTurns = 40,
    timeoutMs = 5 * 60 * 1000,
    // Child-`claude -p` guard (§3.5). When the MCP server shells out for a page
    // follow-up, the nested run must not re-load the HMH plugin, start a second
    // MCP server, fight for the port, or recurse. Belt-and-suspenders:
    //   • --strict-mcp-config (+ no --mcp-config) → no MCP servers load.
    //   • HMH_CHILD_CLAUDE=1 → if the plugin loads anyway, our server boots inert.
    childGuard = true,
  } = options;

  async function inspect({ prompt, codebasePath }) {
    const args = [
      '-p',
      '--output-format', 'json',
      '--allowedTools', allowedTools,
      '--max-turns', String(maxTurns),
    ];
    if (childGuard) args.push('--strict-mcp-config');
    if (model) args.push('--model', model);

    return new Promise((resolve, reject) => {
      // shell:true so Windows resolves the `claude` shim (claude.cmd) from PATH.
      const child = spawn('claude', args, {
        cwd: codebasePath,
        shell: true,
        windowsHide: true,
        env: childGuard ? { ...process.env, HMH_CHILD_CLAUDE: '1' } : process.env,
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`claude timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));

      child.on('error', (err) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new Error('Could not find the `claude` CLI on PATH. Is Claude Code installed?'));
        } else {
          reject(err);
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`claude exited with code ${code}.\n${stderr.trim()}`));
          return;
        }
        resolve(parseEnvelope(stdout));
      });

      // Feed the prompt via stdin and close it.
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  return { inspect };
}

// `--output-format json` prints a single JSON envelope; the model's text is in
// `.result`. Fall back to raw stdout if it isn't the expected shape.
function parseEnvelope(stdout) {
  const trimmed = stdout.trim();
  try {
    const env = JSON.parse(trimmed);
    if (env && typeof env === 'object') {
      if (env.is_error || env.subtype === 'error') {
        throw new Error(`Claude returned an error: ${env.result ?? env.subtype}`);
      }
      if (typeof env.result === 'string') return env.result;
    }
  } catch (err) {
    if (err.message.startsWith('Claude returned an error')) throw err;
    // Not JSON — return raw text and let the core extractor try.
  }
  return trimmed;
}
