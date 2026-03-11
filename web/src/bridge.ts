/**
 * bridge.ts — Browser-side bridge that polls the CheerpX VM for HTTP/cast
 * requests and dispatches them via browser fetch() or cast-browser.ts.
 *
 * IPC protocol (using separate devices):
 *   VM writes requests to /ipc/  (dir-mounted IDBDevice — JS reads via ipcDevice.readFileAsBlob)
 *   JS writes responses to /data/ (DataDevice — VM reads as normal files)
 *
 * Request flow:
 *   VM curl-bridge.sh → /ipc/req_ID.json + /ipc/req_ID.ready
 *   JS reads via readBlob("/req_ID.json"), dispatches fetch/cast
 *   JS writes response via writeToData("/resp_req_ID.json") + writeToData("/resp_req_ID.ready")
 *   VM polls /data/resp_req_ID.ready, reads /data/resp_req_ID.json
 */

import { executeCast } from './cast-browser';
import { readBlob, writeToData } from './cheerpx';

export interface BridgeCallbacks {
  /** Called when an OpenRouter response contains usage data */
  onUsage?: (cost: number, promptTokens: number, completionTokens: number, model: string) => void;
  /** Called to display retry messages in terminal */
  onRetry?: (msg: string) => void;
}

interface CheerpXInstance {
  run(cmd: string, args: string[], opts?: Record<string, unknown>): Promise<{ status: number }>;
}

const POLL_INTERVAL = 500; // ms — keep low pressure on CheerpX WASM VM
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
let polling = false;

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

/** Clear the stop file and reset queue (call before starting agent) */
export async function clearStop(): Promise<void> {
  if (!cx) return;
  processing.clear();
  try {
    await cx.run('/bin/bash', ['-c', `rm -f ${STOP_FILE} /ipc/_queue`], RUN_OPTS);
  } catch { /* ignore */ }
}

/** Ensure bridge directories exist */
export async function ensureDirs(): Promise<void> {
  if (!cx) return;
  await cx.run('/bin/bash', ['-c', 'mkdir -p /tmp/bridge'], RUN_OPTS);
}

/**
 * Poll for requests by reading /ipc/_queue directly via ipcDevice — NO cx.run().
 * curl-bridge.sh and cast-bridge.sh append their request ID to /ipc/_queue
 * instead of relying on ls/sed listing of .ready files.
 */
async function pollForRequests(): Promise<void> {
  if (!cx || polling) return;
  polling = true;

  try {
    const queueBlob = await readBlob('/_queue').catch(() => null);
    if (!queueBlob) return;

    const queueText = await queueBlob.text();
    const ids = queueText.trim().split('\n').filter(Boolean);

    for (const id of ids) {
      if (processing.has(id)) continue;
      processing.add(id);
      handleRequest(id);
    }
  } catch {
    // Polling errors are expected during boot / heavy load — just retry next tick
  } finally {
    polling = false;
  }
}

/** Handle a single bridge request */
async function handleRequest(id: string): Promise<void> {
  if (!cx) return;

  try {
    // Read the request JSON from /ipc via ipcDevice
    const reqBlob = await readBlob(`/${id}.json`);
    if (!reqBlob) {
      console.warn(`[bridge] request ${id}: blob is null (race condition), skipping`);
      return;
    }
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

    // Cap response size to avoid OOM in the 32-bit WASM VM
    const MAX_RESPONSE = 512 * 1024; // 512 KB
    if (responseText.length > MAX_RESPONSE) {
      console.warn(`[bridge] response ${id} truncated: ${responseText.length} bytes → ${MAX_RESPONSE}`);
      responseText = responseText.slice(0, MAX_RESPONSE);
    }

    // Write response to /data via dataDevice (VM reads from /data/resp_ID.json)
    await writeToData(`/resp_${id}.json`, responseText);
    await writeToData(`/resp_${id}.ready`, '');
  } catch (e: any) {
    console.error(`[bridge] error handling request ${id}:`, e);
    // Try to write an error response via dataDevice
    try {
      const errMsg = JSON.stringify({ error: { message: e.message || 'bridge error' } });
      await writeToData(`/resp_${id}.json`, errMsg);
      await writeToData(`/resp_${id}.ready`, '');
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

  // If bodyFile is specified, read it from /ipc via ipcDevice
  if (req.bodyFile && !body) {
    try {
      // bodyFile is an absolute VM path like "/ipc/req_123.body"
      // readBlob expects path relative to /ipc, so strip the /ipc prefix
      const ipcRelPath = req.bodyFile.replace(/^\/ipc/, '');
      const bodyBlob = await readBlob(ipcRelPath);
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
