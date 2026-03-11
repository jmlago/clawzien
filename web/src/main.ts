import { initTerminal, initRawTerminal, toggleRawMode, write, writeln, getBufferText } from './terminal';
import * as vm from './cheerpx';
import * as bridge from './bridge';
import { readConfig, saveConfig, restoreConfig, populateSkillSelect, BROWSER_ENV_CONTEXT, getWalletMode, setWalletMode } from './config';
import { SKILLS } from './skills';
import { createEditor, type Editor } from './editor';
import { privateKeyToAccount } from 'viem/accounts';
import * as privy from './privy';
import { generateWallet, getWallet } from './wallet';
import * as chat from './chat';
import { parseLogEntries, type ActivityEntry } from './chat';
import { buildConfiguratorSkill } from './chat-configurator-skill';

/* ── Skills tab DOM refs ───────────────────────────────── */

let envEditor: Editor;
let skillEditor: Editor;
const skillContentLabel = document.getElementById('skill-content-label')!;
const skillSelect = document.getElementById('skill') as HTMLSelectElement;

/* ── DOM refs ───────────────────────────────────────────── */

const statusEl = document.getElementById('status')!;
const btnRun = document.getElementById('btn-run') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;

let isRunning = false;

/* ── Cron mode state ─────────────────────────────────────── */

let isCronMode = false;
let cronAbort = false;
let cronCountdownTimer: ReturnType<typeof setInterval> | null = null;

/* ── Chat DOM refs ───────────────────────────────────────── */

const chatMessages = document.getElementById('chat-messages')!;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const chatSendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;
let chatStarted = false;

/* ── Chat activity state ──────────────────────────────── */

let currentActivityEl: HTMLDetailsElement | null = null;
let currentActivityContent: HTMLDivElement | null = null;
let currentActivitySummary: HTMLElement | null = null;
let activityEntryCount = 0;
let currentActivityWrapper: HTMLDivElement | null = null;

/* ── Identicon / avatar state ─────────────────────────── */

const CLAWZIEN_SEED = 0xC1A2;
const IDENTICON_COLORS = ['#d4a843', '#5a8a5a', '#c45a5a', '#5a8a8a', '#8a5a8a', '#8a8a5a'];

let flickeringAvatar: HTMLCanvasElement | null = null;
let flickerTimer: ReturnType<typeof setInterval> | null = null;

function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

function generateIdenticon(canvas: HTMLCanvasElement, seed?: number): void {
  const ctx = canvas.getContext('2d')!;
  const rng = seed != null ? seededRng(seed) : () => Math.random();

  const fg = IDENTICON_COLORS[Math.floor(rng() * IDENTICON_COLORS.length)];
  const bg = '#1a1a1a';
  const cellW = canvas.width / 5;
  const cellH = canvas.height / 5;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Generate left half + center column (cols 0-2), mirror for cols 3-4
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (rng() > 0.5) {
        ctx.fillStyle = fg;
        ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
        // Mirror (col 0 → col 4, col 1 → col 3, col 2 is center)
        if (col < 2) {
          ctx.fillRect((4 - col) * cellW, row * cellH, cellW, cellH);
        }
      }
    }
  }
}

function startAvatarFlicker(): void {
  if (!flickeringAvatar) return;
  flickerTimer = setInterval(() => {
    if (flickeringAvatar) generateIdenticon(flickeringAvatar);
  }, 120);
}

function stopAvatarFlicker(): void {
  if (flickerTimer) {
    clearInterval(flickerTimer);
    flickerTimer = null;
  }
  if (flickeringAvatar) {
    generateIdenticon(flickeringAvatar, CLAWZIEN_SEED);
    flickeringAvatar = null;
  }
}

/* ── Token/cost tracking ───────────────────────────────── */

const costRunEl = document.getElementById('cost-run')!;
const costSessionEl = document.getElementById('cost-session')!;
const timerEl = document.getElementById('run-timer')!;

let runCost = 0;
let runIn = 0;
let runOut = 0;
let sessionCost = 0;
let sessionIn = 0;
let sessionOut = 0;
let lastModel = '';
let timerInterval: ReturnType<typeof setInterval> | null = null;
let timerStart = 0;

function fmtUsd(v: number): string {
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toString();
}

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function startTimer() {
  timerStart = Date.now();
  timerEl.textContent = '0s';
  timerInterval = setInterval(() => {
    timerEl.textContent = fmtTime(Math.floor((Date.now() - timerStart) / 1000));
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  // Keep final time displayed
  timerEl.textContent = fmtTime(Math.floor((Date.now() - timerStart) / 1000));
}

function resetRunCost() {
  runCost = 0;
  runIn = 0;
  runOut = 0;
  costRunEl.textContent = '';
}

function addUsage(cost: number, promptTokens: number, completionTokens: number, model: string) {
  runCost += cost;
  runIn += promptTokens;
  runOut += completionTokens;
  sessionCost += cost;
  sessionIn += promptTokens;
  sessionOut += completionTokens;
  if (model) lastModel = model;

  const modelShort = lastModel.replace(/^.*\//, '');
  costRunEl.textContent = `Run: ${fmtUsd(runCost)}  ${fmtTok(runIn)} in / ${fmtTok(runOut)} out  [${modelShort}]`;
  costSessionEl.textContent = `Session: ${fmtUsd(sessionCost)}  ${fmtTok(sessionIn)} in / ${fmtTok(sessionOut)} out`;
}

/* ── Status helpers ─────────────────────────────────────── */

function setStatus(text: string, cls: string = '') {
  statusEl.textContent = text;
  statusEl.className = cls;
}

/* ── Cron helpers ──────────────────────────────────────── */

function updateRunButtonLabel(mode: 'once' | 'cron') {
  btnRun.innerHTML = mode === 'cron'
    ? '&infin; Cron <span class="btn-hint">Ctrl+Enter</span>'
    : 'Run <span class="btn-hint">Ctrl+Enter</span>';
}

function clearCronCountdown() {
  if (cronCountdownTimer) {
    clearInterval(cronCountdownTimer);
    cronCountdownTimer = null;
  }
}

function cronWait(intervalMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const update = () => {
      const remaining = Math.max(0, Math.ceil((intervalMs - (Date.now() - start)) / 1000));
      setStatus(`Cron: waiting (next in ${fmtTime(remaining)})`, 'cron-waiting');
    };
    update();
    cronCountdownTimer = setInterval(() => {
      if (cronAbort) {
        clearCronCountdown();
        resolve(false);
        return;
      }
      const elapsed = Date.now() - start;
      if (elapsed >= intervalMs) {
        clearCronCountdown();
        resolve(true);
        return;
      }
      update();
    }, 1000);
  });
}

async function runCron() {
  const cfg = readConfig();
  const intervalMs = cfg.cronInterval * 60 * 1000;
  const timeoutMs = cfg.cronTimeout * 60 * 1000;

  isCronMode = true;
  cronAbort = false;

  try {
    while (!cronAbort) {
      setStatus('Cron: running', 'running');

      // Per-run timeout: stop the bridge after Y minutes
      const timeoutId = setTimeout(async () => {
        writeln(`\r\nCron: timeout (${cfg.cronTimeout}m) — stopping run...`);
        await bridge.stop();
      }, timeoutMs);

      await run();

      clearTimeout(timeoutId);

      if (cronAbort) break;

      // Wait phase
      const shouldContinue = await cronWait(intervalMs);
      if (!shouldContinue) break;
    }
  } finally {
    clearCronCountdown();
    isCronMode = false;
    cronAbort = false;
    btnRun.disabled = false;
    btnStop.style.display = 'none';
    setStatus('Ready', 'ready');
  }
}

/* ── Session Variables ──────────────────────────────────── */

/**
 * Parse "Session Variables" code block from skill markdown.
 * Returns lines like ['FACTORY=0x...', 'RPC=https://...', ...].
 */
function parseSessionVars(skillContent: string): string[] {
  const m = skillContent.match(/## Session Variables[\s\S]*?```\n([\s\S]*?)```/);
  if (!m) return [];
  return m[1].trim().split('\n').filter((l: string) => l.trim());
}

/**
 * Resolve Session Variables into export statements.
 * Simple assignments (VAR=literal) are kept as-is.
 * Dynamic ones (PRIVKEY, ADDRESS) are resolved from config.
 */
function resolveSessionEnv(
  skillContent: string,
  cfg: { privkey: string },
): string[] {
  const lines = parseSessionVars(skillContent);
  const envLines: string[] = [];

  for (const line of lines) {
    const m = line.match(/^(\w+)=(.+)/);
    if (!m) continue;
    const [, key, value] = m;

    if (value.includes('$(') || value.includes('`')) {
      /* Dynamic — resolve known patterns from config */
      if (key === 'PRIVKEY' && cfg.privkey) {
        envLines.push(`export PRIVKEY="${cfg.privkey}"`);
      } else if (key === 'ADDRESS' && cfg.privkey) {
        try {
          const account = privateKeyToAccount(cfg.privkey as `0x${string}`);
          envLines.push(`export ADDRESS="${account.address}"`);
        } catch (e: any) {
          console.warn('[session] failed to derive address:', e.message);
        }
      }
      /* Skip other dynamic vars we can't resolve */
    } else {
      /* Simple literal assignment */
      envLines.push(`export ${key}="${value}"`);
    }
  }

  return envLines;
}

/* ── Output polling ────────────────────────────────────── */

const OUTPUT_LOG = '/tmp/agent_output.log';    // VM path on ext2 (agent writes here)
let outputPollTimer: ReturnType<typeof setInterval> | null = null;
let lastOutputOffset = 0;

let outputPolling = false;
let termSessionId: string | null = null;
let termSessionLogOffset = 0;

function startOutputPolling() {
  lastOutputOffset = 0;
  outputPolling = false;
  termSessionId = null;
  termSessionLogOffset = 0;
  outputPollTimer = setInterval(async () => {
    if (outputPolling) return; // skip if previous poll still running
    outputPolling = true;
    try {
      // Read from ext2 via exec (creates short-lived file on /ipc that flushes properly)
      const text = await vm.exec(`cat ${OUTPUT_LOG} 2>/dev/null`);
      if (text.length > lastOutputOffset) {
        const newContent = text.slice(lastOutputOffset);
        lastOutputOffset = text.length;

        // Display new output lines, filtering stderr
        for (const line of newContent.split('\n')) {
          if (!line && lastOutputOffset === text.length) continue; // skip trailing empty
          // Reformat turn headers: [N] model... → ── Turn N ──
          const turnMatch = line.match(/^\[(\d+)\]\s/);
          if (turnMatch) {
            writeln(`\n── Turn ${turnMatch[1]} ──`);
          } else if (/^subzeroclaw\s+·/.test(line)) {
            // Extract session ID from header, don't display
            const m = line.match(/·\s+([0-9a-f]{16})/);
            if (m && !termSessionId) {
              termSessionId = m[1];
              termSessionLogOffset = 0;
            }
          } else if (/^\[compact\]/.test(line)) {
            // Skip — will appear in activity
          } else {
            writeln(line);
          }
        }
      }

      // Poll session log for activity
      await pollTerminalSessionLog();
    } catch {
      // File may not exist yet or read may fail during heavy VM load
    } finally {
      outputPolling = false;
    }
  }, 2000); // 2s interval to reduce VM pressure
}

function stopOutputPolling() {
  if (outputPollTimer) {
    clearInterval(outputPollTimer);
    outputPollTimer = null;
  }
}

async function pollTerminalSessionLog(): Promise<void> {
  if (!termSessionId) return;
  try {
    const logPath = `/root/.subzeroclaw/logs/${termSessionId}.txt`;
    const text = await vm.exec(`cat ${logPath} 2>/dev/null`);
    if (text.length <= termSessionLogOffset) return;

    const delta = text.slice(termSessionLogOffset);
    termSessionLogOffset = text.length;

    const entries = parseLogEntries(delta);
    for (const entry of entries) {
      writeTerminalActivity(entry);
    }
  } catch {
    // Log file may not exist yet
  }
}

function writeTerminalActivity(entry: ActivityEntry): void {
  switch (entry.role) {
    case 'TOOL':
      writeln(`  \x1b[33m▸ Tool:\x1b[0m ${entry.content}`);
      break;
    case 'RES': {
      const truncated = entry.content.length > 200
        ? entry.content.slice(0, 200).replace(/\n/g, ' ') + '…'
        : entry.content.replace(/\n/g, ' ');
      writeln(`  \x1b[90m◂ Result:\x1b[0m ${truncated}`);
      break;
    }
    case 'ASST': {
      const truncated = entry.content.length > 300
        ? entry.content.slice(0, 300).replace(/\n/g, ' ') + '…'
        : entry.content.replace(/\n/g, ' ');
      writeln(`  \x1b[32m▸\x1b[0m ${truncated}`);
      break;
    }
    case 'SYS':
      writeln(`  \x1b[90m▸ System:\x1b[0m ${entry.content}`);
      break;
    case 'COMPACT':
      writeln(`  \x1b[90m▸ Context compacted\x1b[0m`);
      break;
  }
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
    /* Read skill content from editors (user may have edited) */
    const skillContent = skillEditor.getValue();
    const envContext = envEditor.getValue();

    /* Derive wallet address using viem in browser */
    let walletAddress: string | undefined;
    if (cfg.privkey) {
      try {
        const account = privateKeyToAccount(cfg.privkey as `0x${string}`);
        walletAddress = account.address;
      } catch { /* skip */ }
    }

    /* Inject config, skills, and keys into VM filesystem */
    await vm.injectConfig({
      apiKey: cfg.apiKey,
      model: cfg.model,
      endpoint: cfg.endpoint,
      skillContent,
      skillName: cfg.skill,
      envContext,
      privkey: cfg.privkey || undefined,
      moltbookKey: cfg.moltbookKey || undefined,
      walletAddress,
    });

    /* Resolve Session Variables */
    const sessionEnv = resolveSessionEnv(skillContent, cfg);
    console.log('[session] env vars:', sessionEnv);

    /* Write session env vars to a file the VM shell can source */
    if (sessionEnv.length > 0) {
      await vm.writeFile('/tmp/session_env.sh', sessionEnv.join('\n'));
    }

    /* Build molly config prefix only for molly skills (require molly-cli in the VM) */
    const isMollySkill = cfg.skill.startsWith('molly/');
    const mollyFactory = skillContent.match(/factoryAddress\s+(0x[0-9a-fA-F]{40})/)?.[1];
    const mollyIdentity = skillContent.match(/identityAddress\s+(0x[0-9a-fA-F]{40})/)?.[1];
    const mollyNetwork = skillContent.match(/network\s+(https?:\/\/\S+)/)?.[1];
    let mollyPrefix = '';
    if (isMollySkill && (mollyFactory || mollyIdentity || cfg.privkey)) {
      const cmds: string[] = [];
      if (mollyFactory) cmds.push(`molly config set factoryAddress ${mollyFactory} > /dev/null 2>&1`);
      if (mollyIdentity) cmds.push(`molly config set identityAddress ${mollyIdentity} > /dev/null 2>&1`);
      if (mollyNetwork) cmds.push(`molly config set network ${mollyNetwork} > /dev/null 2>&1`);
      if (cfg.privkey) cmds.push(`molly config set privateKey ${cfg.privkey} > /dev/null 2>&1`);
      mollyPrefix = cmds.join(' && ') + ' && ';
    }

    writeln(`\r\n--- Running: ${cfg.skill} ---`);
    writeln(`Model: ${cfg.model}`);
    writeln(`Prompt: ${cfg.prompt}\r\n`);

    /* Reset per-run cost tracker, timer, and stop flag */
    resetRunCost();
    startTimer();

    /* Start the bridge (polls for HTTP/cast requests from curl-bridge.sh) */
    bridge.start(vm.getInstance(), {
      onUsage: addUsage,
      onRetry: (msg) => writeln(msg),
    });

    /* Clear any previous stop flag and output log (must be after bridge.start which sets cx) */
    await bridge.clearStop();
    await vm.writeFile(OUTPUT_LOG, '');

    /* Start polling agent output */
    startOutputPolling();

    /* Build the full command to run in the VM */
    const envSetup = sessionEnv.length > 0
      ? `source /tmp/session_env.sh`
      : '';

    const shellCmd = [
      envSetup,
      `export SUBZEROCLAW_API_KEY="${cfg.apiKey}"`,
      `export SUBZEROCLAW_MODEL="${cfg.model}"`,
      `export SUBZEROCLAW_ENDPOINT="${cfg.endpoint}"`,
      mollyPrefix ? `(${mollyPrefix} true)` : '',
      `stdbuf -oL subzeroclaw '${cfg.prompt.replace(/'/g, "'\\''")}'`,
    ].filter(Boolean).join(' && ');

    /* Run subzeroclaw in the VM, redirecting output to the log file.
       Session env vars are sourced from /tmp/session_env.sh inside the shell command,
       NOT passed as CheerpX env entries (CheerpX expects KEY=VALUE, not shell export statements). */
    const exitCode = await vm.run('/bin/bash', ['-c', `${shellCmd} > ${OUTPUT_LOG} 2>&1`]);

    // Final output poll to catch any remaining content
    await new Promise(r => setTimeout(r, 300));
    stopOutputPolling();
    // One last read via exec (ext2 file, not IPC)
    try {
      const text = await vm.exec(`cat ${OUTPUT_LOG} 2>/dev/null`);
      if (text.length > lastOutputOffset) {
        const remaining = text.slice(lastOutputOffset);
        for (const line of remaining.split('\n')) {
          if (!line) continue;
          // Filter stderr lines in final read too
          if (/^subzeroclaw\s+·/.test(line)) {
            const m = line.match(/·\s+([0-9a-f]{16})/);
            if (m && !termSessionId) {
              termSessionId = m[1];
              termSessionLogOffset = 0;
            }
            continue;
          }
          if (/^\[compact\]/.test(line)) continue;
          const turnMatch = line.match(/^\[(\d+)\]\s/);
          if (turnMatch) {
            writeln(`\n── Turn ${turnMatch[1]} ──`);
          } else {
            writeln(line);
          }
        }
      }
    } catch (readErr) {
      console.warn('[output] final read failed:', readErr);
    }
    // Final session log poll
    await pollTerminalSessionLog();

    if (exitCode === 0) {
      writeln('\r\n--- Done ---');
    } else {
      writeln(`\r\n--- Exited with code ${exitCode} ---`);
    }
  } catch (e: any) {
    writeln(`\r\nError: ${e.message || e}`);
  } finally {
    stopOutputPolling();
    await bridge.stop();
    stopTimer();
    isRunning = false;
    if (!isCronMode) {
      btnRun.disabled = false;
      btnStop.style.display = 'none';
      setStatus('Ready', 'ready');
    }
  }
}

/* ── Boot sequence ──────────────────────────────────────── */

async function boot() {
  const termEl = document.getElementById('terminal')!;
  initTerminal(termEl);
  writeln('Clawzien — the simplest GenLayer browser-based citizen');
  writeln('');

  /* Populate skill selector and Skills tab */
  populateSkillSelect(SKILLS);
  restoreConfig();

  /* ── Wallet toggle (Manual ↔ Privy) ──────────────────── */
  const btnManual = document.getElementById('wallet-mode-manual') as HTMLButtonElement;
  const btnPrivy = document.getElementById('wallet-mode-privy') as HTMLButtonElement;
  const walletManual = document.getElementById('wallet-manual')!;
  const walletPrivy = document.getElementById('wallet-privy')!;
  const btnPrivyLogin = document.getElementById('btn-privy-login') as HTMLButtonElement;
  const privyWalletInfo = document.getElementById('privy-wallet-info')!;
  const walletAddrEl = document.getElementById('wallet-addr')!;
  const btnFund = document.getElementById('btn-fund') as HTMLButtonElement;
  const btnPrivyLogout = document.getElementById('btn-privy-logout') as HTMLButtonElement;

  function setWalletUI(mode: 'manual' | 'privy') {
    setWalletMode(mode);
    btnManual.classList.toggle('active', mode === 'manual');
    btnPrivy.classList.toggle('active', mode === 'privy');
    walletManual.style.display = mode === 'manual' ? '' : 'none';
    walletPrivy.style.display = mode === 'privy' ? '' : 'none';
  }

  function showWalletInfo() {
    const w = getWallet();
    if (w) {
      walletAddrEl.textContent = w.address;
      btnPrivyLogin.style.display = 'none';
      privyWalletInfo.style.display = '';
    }
  }

  btnManual.addEventListener('click', () => setWalletUI('manual'));
  btnPrivy.addEventListener('click', () => setWalletUI('privy'));

  /* Initialize Privy if app ID configured */
  const privyAvailable = await privy.init();

  if (privyAvailable) {
    /* Handle OAuth callback if returning from Google */
    const wasCallback = await privy.handleOAuthCallback();
    if (wasCallback) {
      /* Just returned from OAuth — ensure local wallet exists */
      if (!getWallet()) generateWallet();
      setWalletUI('privy');
      showWalletInfo();
    } else if (getWalletMode() === 'privy') {
      /* Restore Privy mode from previous session */
      setWalletUI('privy');
      const authed = await privy.isAuthenticated();
      if (authed && getWallet()) {
        showWalletInfo();
      }
    }

    btnPrivyLogin.addEventListener('click', () => privy.login());

    btnFund.addEventListener('click', () => {
      const w = getWallet();
      if (w) privy.fundWallet(w.address);
    });

    btnPrivyLogout.addEventListener('click', async () => {
      await privy.logout();
      btnPrivyLogin.style.display = '';
      privyWalletInfo.style.display = 'none';
    });
  } else {
    /* No Privy app ID — hide the Sign in toggle */
    btnPrivy.style.display = 'none';
  }

  /* ── Run mode toggle (Once ↔ Cron) ──────────────────── */
  const btnOnce = document.getElementById('run-mode-once') as HTMLButtonElement;
  const btnCron = document.getElementById('run-mode-cron') as HTMLButtonElement;
  const cronConfigEl = document.getElementById('cron-config')!;

  function setRunModeUI(mode: 'once' | 'cron') {
    btnOnce.classList.toggle('active', mode === 'once');
    btnCron.classList.toggle('active', mode === 'cron');
    cronConfigEl.style.display = mode === 'cron' ? '' : 'none';
    updateRunButtonLabel(mode);
  }

  btnOnce.addEventListener('click', () => setRunModeUI('once'));
  btnCron.addEventListener('click', () => setRunModeUI('cron'));

  // Apply restored run mode to button label
  const restoredMode = btnCron.classList.contains('active') ? 'cron' : 'once';
  updateRunButtonLabel(restoredMode as 'once' | 'cron');

  /* Create markdown editors */
  envEditor = createEditor(
    document.getElementById('editor-env')!,
    BROWSER_ENV_CONTEXT,
  );
  skillEditor = createEditor(
    document.getElementById('editor-skill')!,
    '',
  );

  const initialSkill = skillSelect.value;
  if (initialSkill && SKILLS[initialSkill]) {
    skillEditor.setValue(SKILLS[initialSkill]);
    skillContentLabel.textContent = `Skill: ${initialSkill}`;
  }

  /* Update skill editor when dropdown changes */
  skillSelect.addEventListener('change', () => {
    const name = skillSelect.value;
    skillEditor.setValue(SKILLS[name] || '');
    skillContentLabel.textContent = `Skill: ${name}`;
  });

  /* Boot CheerpX VM */
  setStatus('Booting VM...', '');
  writeln('Booting CheerpX Linux VM...');

  // Determine image URL: use env var if set, otherwise default
  const imageUrl = import.meta.env.VITE_VM_IMAGE_URL
    || '/clawzien-vm.ext2';

  try {
    await vm.boot(imageUrl, (msg) => writeln(`  ${msg}`));
    writeln('VM ready.');
  } catch (e: any) {
    setStatus('Error', 'error');
    writeln(`VM boot failed: ${e.message}`);
    writeln('Tip: CheerpX requires COOP/COEP headers. Use "npm run dev".');
    writeln('     Make sure the VM image exists at: ' + imageUrl);
    return;
  }

  /* Initialize raw terminal for Advanced mode */
  const rawTermEl = document.getElementById('raw-terminal')!;
  const rawTerm = initRawTerminal(rawTermEl);

  /* Connect raw terminal to CheerpX console */
  const cxReadFunc = vm.connectConsole(
    (buf, vt) => {
      if (vt !== 1) return;
      rawTerm.write(new Uint8Array(buf));
    },
    rawTerm.cols,
    rawTerm.rows,
  );

  /* Forward raw terminal input to CheerpX */
  rawTerm.onData((str) => {
    for (let i = 0; i < str.length; i++) {
      cxReadFunc(str.charCodeAt(i));
    }
  });

  /* Start a tmux session for the raw terminal (runs in background) */
  vm.run('/bin/bash', ['-c',
    'tmux new-session -d -s clawzien -n shared 2>/dev/null; exec tmux attach -t clawzien'
  ]).catch(() => {});

  /* Advanced toggle button */
  const btnAdvanced = document.getElementById('btn-toggle-advanced')!;
  btnAdvanced.addEventListener('click', () => {
    const isRaw = toggleRawMode();
    btnAdvanced.classList.toggle('active', isRaw);
  });

  /* Ready */
  setStatus('Ready', 'ready');
  writeln('');
  writeln('Ready. Fill in config and click Run.');
  btnRun.disabled = false;

  /* Chat is the default tab — initialize it now */
  ensureChatStarted();
}

/* ── Helpers ────────────────────────────────────────────── */

function switchToTerminal() {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector('[data-view="run"]')!.classList.add('active');
  document.getElementById('view-run')!.classList.add('active');
}

/* ── Event listeners ────────────────────────────────────── */

btnRun.addEventListener('click', () => {
  switchToTerminal();
  const cfg = readConfig();
  cfg.runMode === 'cron' ? runCron() : run();
});

btnStop.addEventListener('click', async () => {
  writeln('\r\nStopping agent...');
  btnStop.disabled = true;
  cronAbort = true;
  clearCronCountdown();
  await bridge.stop();
});

/* Ctrl+Enter from anywhere triggers run */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!isRunning && !isCronMode) {
      switchToTerminal();
      const cfg = readConfig();
      cfg.runMode === 'cron' ? runCron() : run();
    }
  }
});

/* Copy terminal contents */
document.getElementById('btn-copy-term')!.addEventListener('click', () => {
  const text = getBufferText();
  const btn = document.getElementById('btn-copy-term')!;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy terminal';
      btn.classList.remove('copied');
    }, 1500);
  });
});

/* Copy chat contents (includes activity summaries) */
document.getElementById('btn-copy-chat')!.addEventListener('click', () => {
  const lines: string[] = [];

  function processBubble(el: HTMLElement) {
    const role = el.classList.contains('user') ? 'You' :
                 el.classList.contains('assistant') ? 'Clawzien' : 'System';
    const ts = el.querySelector('.chat-timestamp')?.textContent || '';
    const content = el.querySelector('span:not(.chat-timestamp)')?.textContent || el.textContent || '';
    lines.push(`[${ts}] ${role}: ${content.trim()}`);
  }

  function processActivity(el: HTMLElement) {
    const summary = el.querySelector('.chat-activity-summary')?.textContent || '';
    lines.push(`--- ${summary} ---`);
    el.querySelectorAll('.activity-entry').forEach(entry => {
      const label = entry.querySelector('.activity-label')?.textContent || '';
      const body = entry.querySelector('.activity-body')?.textContent || '';
      lines.push(`  ${label}${body}`);
    });
  }

  chatMessages.childNodes.forEach(node => {
    if (!(node instanceof HTMLElement)) return;

    if (node.classList.contains('chat-msg')) {
      // Wrapped message — find bubble or activity inside
      const bubble = node.querySelector('.chat-bubble') as HTMLElement | null;
      if (bubble) processBubble(bubble);
      const activity = node.querySelector('.chat-activity') as HTMLElement | null;
      if (activity) processActivity(activity);
    } else if (node.classList.contains('chat-bubble')) {
      // Unwrapped system message
      processBubble(node);
    } else if (node.classList.contains('chat-activity')) {
      // Unwrapped activity (shouldn't happen with new code, but be safe)
      processActivity(node);
    }
  });

  const btn = document.getElementById('btn-copy-chat')!;
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy chat';
      btn.classList.remove('copied');
    }, 1500);
  });
});

/* ── Chat helpers ──────────────────────────────────────── */

function formatTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function createSenderHeader(role: 'user' | 'assistant'): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'chat-sender';

  if (role === 'assistant') {
    const avatar = document.createElement('canvas');
    avatar.className = 'chat-avatar';
    avatar.width = 24;
    avatar.height = 24;
    generateIdenticon(avatar, CLAWZIEN_SEED);
    header.appendChild(avatar);
  }

  const name = document.createElement('span');
  name.className = 'chat-sender-name';
  name.textContent = role === 'user' ? 'You' : 'Clawzien';
  header.appendChild(name);

  return header;
}

function appendChatMessage(role: 'user' | 'assistant' | 'system', text: string) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;

  const content = document.createElement('span');
  content.textContent = text;
  bubble.appendChild(content);

  const ts = document.createElement('span');
  ts.className = 'chat-timestamp';
  ts.textContent = formatTimestamp();
  bubble.appendChild(ts);

  if (role === 'system') {
    // System messages remain unwrapped
    chatMessages.appendChild(bubble);
  } else {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-msg ${role}`;
    wrapper.appendChild(createSenderHeader(role));
    wrapper.appendChild(bubble);
    chatMessages.appendChild(wrapper);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* ── Chat activity rendering ───────────────────────────── */

function createActivityContainer(): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-msg assistant';

  // Sender header with flickering avatar
  const header = document.createElement('div');
  header.className = 'chat-sender';

  const avatar = document.createElement('canvas');
  avatar.className = 'chat-avatar';
  avatar.width = 24;
  avatar.height = 24;
  generateIdenticon(avatar, CLAWZIEN_SEED);
  header.appendChild(avatar);

  const name = document.createElement('span');
  name.className = 'chat-sender-name';
  name.textContent = 'Clawzien';
  header.appendChild(name);

  wrapper.appendChild(header);

  const details = document.createElement('details');
  details.className = 'chat-activity';

  const summary = document.createElement('summary');
  summary.className = 'chat-activity-summary';
  summary.textContent = 'Agent working...';
  details.appendChild(summary);

  const content = document.createElement('div');
  content.className = 'chat-activity-content';
  details.appendChild(content);

  wrapper.appendChild(details);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  currentActivityEl = details;
  currentActivityContent = content;
  currentActivitySummary = summary;
  currentActivityWrapper = wrapper;
  activityEntryCount = 0;

  // Start flickering the avatar
  flickeringAvatar = avatar;
  startAvatarFlicker();
}

function formatActivityLabel(entry: ActivityEntry): string {
  const time = entry.timestamp.split(' ')[1] || entry.timestamp;
  switch (entry.role) {
    case 'TOOL': return `[${time}] Tool: `;
    case 'RES': return `[${time}] Result: `;
    case 'ASST': return `[${time}] Thinking: `;
    case 'SYS': return `[${time}] System: `;
    case 'COMPACT': return `[${time}] Compact: `;
    default: return `[${time}] ${entry.role}: `;
  }
}

function appendActivityEntries(entries: ActivityEntry[]): void {
  if (!currentActivityEl) {
    createActivityContainer();
  }

  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = `activity-entry activity-${entry.role.toLowerCase()}`;

    const label = document.createElement('span');
    label.className = 'activity-label';
    label.textContent = formatActivityLabel(entry);
    div.appendChild(label);

    const body = document.createElement('span');
    body.className = 'activity-body';
    const text = entry.role === 'RES' && entry.content.length > 500
      ? entry.content.slice(0, 500) + '...'
      : entry.content;
    body.textContent = text;
    div.appendChild(body);

    currentActivityContent!.appendChild(div);
    activityEntryCount++;
  }

  currentActivitySummary!.textContent = `Agent working... (${activityEntryCount} steps)`;
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function finalizeActivity(): void {
  if (currentActivitySummary) {
    currentActivitySummary.textContent = `Agent activity (${activityEntryCount} steps)`;
  }
  stopAvatarFlicker();
  currentActivityEl = null;
  currentActivityContent = null;
  currentActivitySummary = null;
  currentActivityWrapper = null;
  activityEntryCount = 0;
}

function ensureChatStarted() {
  if (chatStarted) return;
  chatStarted = true;

  const cfg = readConfig();
  const envContext = envEditor?.getValue() || BROWSER_ENV_CONTEXT;

  const configuratorSkill = buildConfiguratorSkill(
    cfg.skill,
    cfg.prompt,
    cfg.model,
    envContext,
  );

  chat.startChat(
    configuratorSkill,
    cfg.apiKey,
    cfg.model,
    cfg.endpoint,
    envContext,
    {
      onMessage: appendChatMessage,
      onActivity: appendActivityEntries,
      onActivityDone: finalizeActivity,
    },
  );
}

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !chat.isChatRunning() || chat.isChatBusy()) return;

  // Reset activity state for new message
  currentActivityEl = null;
  currentActivityContent = null;
  currentActivitySummary = null;
  currentActivityWrapper = null;
  activityEntryCount = 0;

  appendChatMessage('user', text);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  chat.sendMessage(text);
}

/* Chat input: Enter to send, Shift+Enter for newline */
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

/* Auto-resize textarea */
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

/* Send button click */
chatSendBtn.addEventListener('click', sendChatMessage);

/* Chat tab click — lazy init */
document.querySelector('[data-view="chat"]')!.addEventListener('click', () => {
  ensureChatStarted();
});

/* ── Start ──────────────────────────────────────────────── */

boot();
