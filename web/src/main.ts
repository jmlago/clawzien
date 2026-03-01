import { initTerminal, initRawTerminal, toggleRawMode, write, writeln, getBufferText } from './terminal';
import * as vm from './cheerpx';
import * as bridge from './bridge';
import { readConfig, saveConfig, restoreConfig, populateSkillSelect, BROWSER_ENV_CONTEXT, getWalletMode, setWalletMode } from './config';
import { SKILLS } from './skills';
import { createEditor, type Editor } from './editor';
import { privateKeyToAccount } from 'viem/accounts';
import * as privy from './privy';
import { generateWallet, getWallet } from './wallet';

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

const OUTPUT_LOG = '/tmp/agent_output.log';
let outputPollTimer: ReturnType<typeof setInterval> | null = null;
let lastOutputOffset = 0;

function startOutputPolling() {
  lastOutputOffset = 0;
  outputPollTimer = setInterval(async () => {
    try {
      const cxInstance = vm.getInstance();
      const blob = await cxInstance.readFileAsBlob(OUTPUT_LOG);
      const text = await blob.text();
      if (text.length > lastOutputOffset) {
        const newContent = text.slice(lastOutputOffset);
        lastOutputOffset = text.length;

        // Display new output lines
        for (const line of newContent.split('\n')) {
          if (!line && lastOutputOffset === text.length) continue; // skip trailing empty
          // Reformat turn headers: [N] model... → ── Turn N ──
          const turnMatch = line.match(/^\[(\d+)\]\s/);
          if (turnMatch) {
            writeln(`\n── Turn ${turnMatch[1]} ──`);
          } else {
            writeln(line);
          }
        }
      }
    } catch {
      // File may not exist yet or read may fail during heavy VM load
    }
  }, 200);
}

function stopOutputPolling() {
  if (outputPollTimer) {
    clearInterval(outputPollTimer);
    outputPollTimer = null;
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

    /* Build molly config prefix for skills that use molly-cli */
    const mollyFactory = skillContent.match(/factoryAddress\s+(0x[0-9a-fA-F]{40})/)?.[1];
    const mollyIdentity = skillContent.match(/identityAddress\s+(0x[0-9a-fA-F]{40})/)?.[1];
    const mollyNetwork = skillContent.match(/network\s+(https?:\/\/\S+)/)?.[1];
    let mollyPrefix = '';
    if (mollyFactory || mollyIdentity || cfg.privkey) {
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

    /* Clear any previous stop flag and output log */
    await bridge.clearStop();
    await vm.writeFile(OUTPUT_LOG, '');

    /* Start the bridge (polls for HTTP/cast requests from curl-bridge.sh) */
    bridge.start(vm.getInstance(), {
      onUsage: addUsage,
      onRetry: (msg) => writeln(msg),
    });

    /* Start polling agent output */
    startOutputPolling();

    /* Build the full command to run in the VM */
    const envSetup = sessionEnv.length > 0
      ? `source /tmp/session_env.sh && `
      : '';

    const shellCmd = [
      envSetup,
      `export SUBZEROCLAW_API_KEY="${cfg.apiKey}"`,
      `export SUBZEROCLAW_MODEL="${cfg.model}"`,
      `export SUBZEROCLAW_ENDPOINT="${cfg.endpoint}"`,
      mollyPrefix ? `(${mollyPrefix} true)` : '',
      `subzeroclaw '${cfg.prompt.replace(/'/g, "'\\''")}'`,
    ].filter(Boolean).join(' && ');

    /* Run subzeroclaw in the VM, redirecting output to the log file */
    const exitCode = await vm.run('/bin/bash', ['-c', `${shellCmd} > ${OUTPUT_LOG} 2>&1`], sessionEnv);

    // Final output poll to catch any remaining content
    await new Promise(r => setTimeout(r, 300));
    stopOutputPolling();
    // One last read
    try {
      const blob = await vm.getInstance().readFileAsBlob(OUTPUT_LOG);
      const text = await blob.text();
      if (text.length > lastOutputOffset) {
        const remaining = text.slice(lastOutputOffset);
        for (const line of remaining.split('\n')) {
          if (line) writeln(line);
        }
      }
    } catch { /* ignore */ }

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
    btnRun.disabled = false;
    btnStop.style.display = 'none';
    setStatus('Ready', 'ready');
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
  run();
});

btnStop.addEventListener('click', async () => {
  writeln('\r\nStopping agent...');
  btnStop.disabled = true;
  await bridge.stop();
});

/* Ctrl+Enter from anywhere triggers run */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!isRunning) {
      switchToTerminal();
      run();
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

/* ── Start ──────────────────────────────────────────────── */

boot();
