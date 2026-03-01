/**
 * bridge.ts — Browser-side bridge that polls the CheerpX VM for HTTP/cast
 * requests and dispatches them via browser fetch() or cast-browser.ts.
 *
 * Protocol:
 *   VM writes:  /tmp/bridge/requests/<id>.json  + touches <id>.ready
 *   Bridge reads request, dispatches, writes response to:
 *               /tmp/bridge/responses/<id>.json  + touches <id>.ready
 *
 * Request types:
 *   { type: "http", method, url, headers, bodyFile?, body?, timeout }
 *   { type: "cast", args: string[] }
 *
 * Response (written as raw text — the body of the HTTP response or cast output):
 *   For HTTP: the raw response body text
 *   For cast: the cast output text
 */

import { executeCast } from './cast-browser';

export interface BridgeCallbacks {
  /** Called when an OpenRouter response contains usage data */
  onUsage?: (cost: number, promptTokens: number, completionTokens: number, model: string) => void;
  /** Called to display retry messages in terminal */
  onRetry?: (msg: string) => void;
}

interface CheerpXInstance {
  run(cmd: string, args: string[], opts?: Record<string, unknown>): Promise<number>;
  readFileAsBlob(path: string): Promise<Blob>;
}

const POLL_INTERVAL = 100; // ms
const REQUESTS_DIR = '/tmp/bridge/requests';
const RESPONSES_DIR = '/tmp/bridge/responses';
const STOP_FILE = '/tmp/bridge/stop';

const RUN_OPTS = {
  env: ['HOME=/root', 'TERM=xterm', 'PATH=/usr/local/bin:/usr/bin:/bin'],
  cwd: '/',
  uid: 0,
  gid: 0,
};

let cx: CheerpXInstance | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let callbacks: BridgeCallbacks = {};
let processing = new Set<string>();

/** Start the bridge polling loop */
export function start(cxInstance: CheerpXInstance, cbs: BridgeCallbacks = {}): void {
  cx = cxInstance;
  callbacks = cbs;

  if (pollTimer) return;
  pollTimer = setInterval(pollForRequests, POLL_INTERVAL);
}

/** Stop the bridge and write the stop file into the VM */
export async function stop(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (cx) {
    try {
      await cx.run('/bin/bash', ['-c', `touch ${STOP_FILE}`], RUN_OPTS);
    } catch { /* VM may already be down */ }
  }
}

/** Clear the stop file (call before starting agent) */
export async function clearStop(): Promise<void> {
  if (!cx) return;
  try {
    await cx.run('/bin/bash', ['-c', `rm -f ${STOP_FILE}`], RUN_OPTS);
  } catch { /* ignore */ }
}

/** Ensure bridge directories exist */
export async function ensureDirs(): Promise<void> {
  if (!cx) return;
  await cx.run('/bin/bash', ['-c', `mkdir -p ${REQUESTS_DIR} ${RESPONSES_DIR}`], RUN_OPTS);
}

/** Poll for .ready files in the requests directory */
async function pollForRequests(): Promise<void> {
  if (!cx) return;

  try {
    // List .ready files in the requests dir
    const blob = await cx.readFileAsBlob(`${REQUESTS_DIR}/.poll`).catch(() => null);
    // readFileAsBlob on a specific file won't list directories.
    // Instead, run a quick ls to find .ready files
    // We use a lightweight approach: run ls and capture output via a temp file
    await cx.run('/bin/bash', ['-c',
      `ls ${REQUESTS_DIR}/*.ready 2>/dev/null | sed 's/.*\\///' | sed 's/\\.ready$//' > /tmp/bridge/_pending.txt 2>/dev/null || true`,
    ], RUN_OPTS);

    const pendingBlob = await cx.readFileAsBlob('/tmp/bridge/_pending.txt').catch(() => null);
    if (!pendingBlob) return;

    const pendingText = await pendingBlob.text();
    const ids = pendingText.trim().split('\n').filter(Boolean);

    for (const id of ids) {
      if (processing.has(id)) continue;
      processing.add(id);
      handleRequest(id).finally(() => processing.delete(id));
    }
  } catch {
    // Polling errors are expected during boot / heavy load — just retry next tick
  }
}

/** Handle a single bridge request */
async function handleRequest(id: string): Promise<void> {
  if (!cx) return;

  try {
    // Read the request JSON
    const reqBlob = await cx.readFileAsBlob(`${REQUESTS_DIR}/${id}.json`);
    const reqText = await reqBlob.text();
    const req = JSON.parse(reqText);

    let responseText: string;

    if (req.type === 'http') {
      responseText = await handleHttpRequest(req);
    } else if (req.type === 'cast') {
      responseText = await handleCastRequest(req);
    } else {
      responseText = JSON.stringify({ error: { message: `unknown request type: ${req.type}` } });
    }

    // Write response back to VM
    // Use base64 encoding to avoid shell escaping issues
    // Split into chunks to avoid shell argument length limits
    const responseB64 = btoa(unescape(encodeURIComponent(responseText)));
    const CHUNK_SIZE = 65536;
    if (responseB64.length <= CHUNK_SIZE) {
      await cx.run('/bin/bash', ['-c',
        `printf '%s' '${responseB64}' | base64 -d > ${RESPONSES_DIR}/${id}.json && touch ${RESPONSES_DIR}/${id}.ready`,
      ], RUN_OPTS);
    } else {
      // Write base64 data in chunks, then decode
      const tmpB64 = `/tmp/bridge/_resp_${id}.b64`;
      await cx.run('/bin/bash', ['-c', `> ${tmpB64}`], RUN_OPTS);
      for (let i = 0; i < responseB64.length; i += CHUNK_SIZE) {
        const chunk = responseB64.slice(i, i + CHUNK_SIZE);
        await cx.run('/bin/bash', ['-c',
          `printf '%s' '${chunk}' >> ${tmpB64}`,
        ], RUN_OPTS);
      }
      await cx.run('/bin/bash', ['-c',
        `base64 -d ${tmpB64} > ${RESPONSES_DIR}/${id}.json && rm -f ${tmpB64} && touch ${RESPONSES_DIR}/${id}.ready`,
      ], RUN_OPTS);
    }
  } catch (e: any) {
    console.error(`[bridge] error handling request ${id}:`, e);
    // Try to write an error response
    try {
      const errMsg = (e.message || 'bridge error').replace(/'/g, "'\\''");
      await cx!.run('/bin/bash', ['-c',
        `echo '{"error":{"message":"${errMsg}"}}' > ${RESPONSES_DIR}/${id}.json && touch ${RESPONSES_DIR}/${id}.ready`,
      ], RUN_OPTS);
    } catch { /* give up */ }
  }
}

/** Handle an HTTP bridge request (curl replacement) */
async function handleHttpRequest(req: {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyFile?: string;
  body?: string;
  timeout?: number;
}): Promise<string> {
  let body = req.body;

  // If bodyFile is specified, read it from the VM
  if (req.bodyFile && !body) {
    try {
      const bodyBlob = await cx!.readFileAsBlob(req.bodyFile);
      body = await bodyBlob.text();
    } catch (e: any) {
      console.error('[bridge] failed to read body file:', e.message);
      body = '';
    }
  }

  const MAX_RETRIES = 5;
  const delays = [2, 4, 8, 16, 32];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[bridge] fetch: ${req.method} ${req.url}`, attempt > 0 ? `(retry ${attempt})` : '');

      const resp = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: body || undefined,
      });

      const text = await resp.text();

      // Retry on 429 or 5xx
      if ((resp.status === 429 || resp.status >= 500) && attempt < MAX_RETRIES) {
        const wait = delays[attempt];
        callbacks.onRetry?.(`  [retry] ${resp.status} — waiting ${wait}s...`);
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }

      // Extract cost/usage from OpenRouter responses
      try {
        const json = JSON.parse(text);
        if (json.usage && callbacks.onUsage) {
          callbacks.onUsage(
            json.usage.cost || 0,
            json.usage.prompt_tokens || 0,
            json.usage.completion_tokens || 0,
            json.model || '',
          );
        }
      } catch { /* not JSON or no usage — skip */ }

      return text;
    } catch (e: any) {
      if (attempt < MAX_RETRIES) {
        const wait = delays[attempt];
        callbacks.onRetry?.(`  [retry] fetch failed — waiting ${wait}s...`);
        console.error(`[bridge] fetch error (attempt ${attempt + 1}):`, e);
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      console.error('[bridge] fetch error (final):', e);
      return JSON.stringify({ error: { message: `fetch failed: ${e.message}` } });
    }
  }

  return JSON.stringify({ error: { message: 'fetch failed after retries' } });
}

/** Handle a cast bridge request */
async function handleCastRequest(req: { id: string; args: string[] }): Promise<string> {
  try {
    const result = await executeCast(req.args);
    return result ?? `Error: unrecognized cast subcommand: ${req.args[0]}`;
  } catch (e: any) {
    return `Error: ${e.message || e}`;
  }
}
