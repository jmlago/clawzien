import { initTerminal, write, writeln } from './terminal';
import * as wc from './webcontainer';
import { readConfig, saveConfig, restoreConfig, populateSkillSelect, writeConfigToFS } from './config';
import { SKILLS } from './skills';

/* ── DOM refs ───────────────────────────────────────────── */

const statusEl = document.getElementById('status')!;
const btnRun = document.getElementById('btn-run') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;

let wasmModule: any = null;
let isRunning = false;

/* ── Status helpers ─────────────────────────────────────── */

function setStatus(text: string, cls: string = '') {
  statusEl.textContent = text;
  statusEl.className = cls;
}

/* ── Curl fetch (called from library_popen.js) ──────────── */

async function doCurlFetch(cmd: string, FS: any): Promise<string> {
  const kMatch = cmd.match(/-K\s+'([^']+)'/);
  const bodyMatch = cmd.match(/-d\s+@'([^']+)'/);
  /* Find the URL: last single-quoted string that looks like http */
  const urlMatches = [...cmd.matchAll(/'(https?:\/\/[^']+)'/g)];
  const url = urlMatches.length > 0 ? urlMatches[urlMatches.length - 1][1] : null;
  const inlineHeaders = [...cmd.matchAll(/-H\s+'([^']+)'/g)];

  const headers: Record<string, string> = {};

  for (const [, hdr] of inlineHeaders) {
    const colon = hdr.indexOf(':');
    if (colon > 0) {
      headers[hdr.slice(0, colon).trim()] = hdr.slice(colon + 1).trim();
    }
  }

  if (kMatch) {
    try {
      const hdrContent: string = FS.readFile(kMatch[1], { encoding: 'utf8' });
      const authMatch = hdrContent.match(/-H\s+"([^"]+)"/);
      if (authMatch) {
        const colon = authMatch[1].indexOf(':');
        if (colon > 0) {
          headers[authMatch[1].slice(0, colon).trim()] = authMatch[1].slice(colon + 1).trim();
        }
      }
    } catch { /* file not found — non-fatal */ }
  }

  let body: string | undefined;
  if (bodyMatch) {
    try {
      body = FS.readFile(bodyMatch[1], { encoding: 'utf8' });
    } catch { body = ''; }
  }

  if (!url) return 'error: could not parse URL from curl command';

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });
    return await resp.text();
  } catch (e: any) {
    return `error: fetch failed: ${e.message}`;
  }
}

/* ── Load Emscripten WASM module ────────────────────────── */

function loadWasm(): Promise<any> {
  return new Promise((resolve, reject) => {
    const Module: any = {
      print: (text: string) => writeln(text),
      printErr: (text: string) => writeln(text),
      onRuntimeInitialized: () => resolve(Module),
      _popenFiles: new Map(),
      _shellExec: (cmd: string) => wc.exec(cmd),
      _doCurlFetch: doCurlFetch,
    };
    (window as any).Module = Module;

    const script = document.createElement('script');
    script.src = '/subzeroclaw.js';
    script.onerror = () => reject(new Error('Failed to load subzeroclaw.js — run build-wasm.sh first'));
    document.head.appendChild(script);
  });
}

/* ── Run agent ──────────────────────────────────────────── */

async function run() {
  const cfg = readConfig();

  if (!cfg.apiKey) {
    writeln('Error: API key is required.');
    return;
  }
  if (!cfg.prompt) {
    writeln('Error: Prompt is required.');
    return;
  }

  saveConfig(cfg);
  isRunning = true;
  btnRun.disabled = true;
  btnStop.style.display = '';
  btnStop.disabled = false;
  setStatus('Running...', 'running');

  try {
    /* Write config + skills to Emscripten FS */
    const skillContent = SKILLS[cfg.skill] || '';
    writeConfigToFS(wasmModule, cfg, skillContent, cfg.skill);

    /* Also write keys into WebContainers FS */
    await wc.writeRuntimeFiles({
      privkey: cfg.privkey || undefined,
      moltbookKey: cfg.moltbookKey || undefined,
    });

    writeln(`\r\n--- Running: ${cfg.skill} ---`);
    writeln(`Model: ${cfg.model}`);
    writeln(`Prompt: ${cfg.prompt}\r\n`);

    /* Run the agent (one-shot mode) */
    wasmModule.callMain([cfg.prompt]);

    writeln('\r\n--- Done ---');
  } catch (e: any) {
    writeln(`\r\nError: ${e.message || e}`);
  } finally {
    isRunning = false;
    btnRun.disabled = false;
    btnStop.style.display = 'none';
    setStatus('Ready', 'ready');
  }
}

/* ── Boot sequence ──────────────────────────────────────── */

async function boot() {
  const termEl = document.getElementById('terminal')!;
  initTerminal(termEl);
  writeln('Clawzien — browser runtime');
  writeln('');

  /* Populate skill selector */
  populateSkillSelect(SKILLS);
  restoreConfig();

  /* Step 1: Boot WebContainers */
  setStatus('Booting runtime...', '');
  writeln('Booting WebContainers...');
  try {
    await wc.boot();
    writeln('WebContainers ready.');
  } catch (e: any) {
    setStatus('Error', 'error');
    writeln(`WebContainers boot failed: ${e.message}`);
    writeln('Tip: WebContainers require COOP/COEP headers. Use "npm run dev".');
    return;
  }

  /* Step 2: Install deps */
  setStatus('Installing tools...', '');
  try {
    await wc.installDeps((msg) => write(msg));
    writeln('Tools installed.');
  } catch (e: any) {
    writeln(`Warning: dependency install failed: ${e.message}`);
    writeln('Some tools (molly-cli) may not be available.');
  }

  /* Step 3: Load WASM module */
  setStatus('Loading WASM...', '');
  writeln('Loading SubZeroClaw WASM...');
  try {
    wasmModule = await loadWasm();

    /* Pre-create /home and /tmp in MEMFS */
    try { wasmModule.FS.mkdir('/home'); } catch { /* exists */ }
    try { wasmModule.FS.mkdir('/home/web'); } catch { /* exists */ }
    try { wasmModule.FS.mkdir('/tmp'); } catch { /* exists */ }

    writeln('WASM loaded.');
  } catch (e: any) {
    setStatus('Error', 'error');
    writeln(`WASM load failed: ${e.message}`);
    return;
  }

  /* Ready */
  setStatus('Ready', 'ready');
  writeln('');
  writeln('Ready. Fill in config and click Run.');
  btnRun.disabled = false;
}

/* ── Event listeners ────────────────────────────────────── */

btnRun.addEventListener('click', run);

btnStop.addEventListener('click', () => {
  /* TODO: abort mechanism (would require Asyncify unwinding) */
  writeln('\r\nStop requested (agent will finish current turn).');
  btnStop.disabled = true;
});

/* Ctrl+Enter in prompt textarea triggers run */
document.getElementById('prompt')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !btnRun.disabled) {
    e.preventDefault();
    run();
  }
});

/* ── Start ──────────────────────────────────────────────── */

boot();
