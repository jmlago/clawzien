/**
 * chat.ts — Chat lifecycle module.
 *
 * Runs subzeroclaw one-shot in the CheerpX VM for each user message — the same
 * proven pattern the main agent uses.  Each invocation gets the configurator
 * skill, full tool access (curl-bridge, cast, etc.), and writes output to a
 * dedicated log file that we poll from JS.
 *
 * Key design: startChat() does NO VM operations.  All VM interaction happens
 * inside sendMessage() so the chat tab can't interfere with the main agent.
 */

import * as vm from './cheerpx';
import * as bridge from './bridge';

export interface ChatCallbacks {
  onMessage: (role: 'user' | 'assistant' | 'system', text: string) => void;
}

const CHAT_LOG = '/tmp/chat_output.log';

let running = false;
let busy = false;
let callbacks: ChatCallbacks | null = null;
let chatSkill = '';
let chatApiKey = '';
let chatModel = '';
let chatEndpoint = '';
let chatEnvContext = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastOffset = 0;
let polling = false;

/**
 * Start the chat session.  Just stores config — no VM operations.
 */
export function startChat(
  skill: string,
  apiKey: string,
  model: string,
  endpoint: string,
  envContext: string,
  cbs: ChatCallbacks,
): void {
  if (running) return;

  running = true;
  callbacks = cbs;
  chatSkill = skill;
  chatApiKey = apiKey;
  chatModel = model;
  chatEndpoint = endpoint;
  chatEnvContext = envContext;

  cbs.onMessage('system', 'Chat ready. Type a message below.');
}

/**
 * Send a user message.  Injects config, runs subzeroclaw one-shot, polls output.
 * Self-contained: sets up and tears down its own VM state per message.
 */
export async function sendMessage(text: string): Promise<void> {
  if (!running || !callbacks || busy) return;

  const apiKey = getDomValue('api-key') || chatApiKey;
  const model = getDomValue('model') || chatModel;
  const endpoint = getDomValue('endpoint') || chatEndpoint;

  if (!apiKey) {
    callbacks.onMessage('system', 'API key is required. Set it in Settings.');
    return;
  }

  busy = true;

  try {
    // Inject configurator skill + config into the VM
    await vm.injectConfig({
      apiKey,
      model,
      endpoint,
      skillContent: chatSkill,
      skillName: '_configurator',
      envContext: chatEnvContext,
    });

    // Ensure bridge is running and stop flag is clear
    bridge.start(vm.getInstance(), {});
    await bridge.clearStop();

    // Clear previous output log
    await vm.writeFile(CHAT_LOG, '');
    lastOffset = 0;

    // Start polling the output log
    startOutputPolling();

    // Build the one-shot command (same pattern as main run())
    const escaped = text.replace(/'/g, "'\\''");
    const shellCmd = [
      `export SUBZEROCLAW_API_KEY="${apiKey}"`,
      `export SUBZEROCLAW_MODEL="${model}"`,
      `export SUBZEROCLAW_ENDPOINT="${endpoint}"`,
      `stdbuf -oL subzeroclaw '${escaped}'`,
    ].join(' && ');

    await vm.run('/bin/bash', ['-c', `${shellCmd} > ${CHAT_LOG} 2>&1`]);

    // Final poll to catch remaining output
    await new Promise(r => setTimeout(r, 500));
    await flushOutput();
  } catch (e: any) {
    callbacks?.onMessage('system', `Error: ${e.message}`);
  } finally {
    stopOutputPolling();
    // Stop bridge polling so it doesn't waste VM resources between messages
    // (main agent's run() will start it fresh when needed)
    bridge.stop().catch(() => {});
    // Clean up configurator skill so it doesn't interfere with the main agent
    await vm.run('/bin/bash', ['-c',
      'rm -f /root/.subzeroclaw/skills/_configurator.md 2>/dev/null',
    ]).catch(() => {});
    busy = false;
  }
}

/**
 * Stop the chat session.
 */
export async function stopChat(): Promise<void> {
  stopOutputPolling();
  running = false;
  busy = false;
  callbacks = null;
}

export function isChatRunning(): boolean {
  return running;
}

export function isChatBusy(): boolean {
  return busy;
}

/* ── Output polling ──────────────────────────────────── */

function startOutputPolling(): void {
  pollTimer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      await flushOutput();
    } finally {
      polling = false;
    }
  }, 2000);
}

function stopOutputPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function flushOutput(): Promise<void> {
  if (!callbacks) return;
  try {
    const text = await vm.exec(`cat ${CHAT_LOG} 2>/dev/null`);
    if (text.length <= lastOffset) return;

    const newContent = text.slice(lastOffset);
    lastOffset = text.length;

    const trimmed = newContent.trim();
    if (trimmed) {
      callbacks.onMessage('assistant', trimmed);
    }
  } catch {
    // File may not exist yet or VM busy
  }
}

/* ── Helpers ──────────────────────────────────────────── */

function getDomValue(id: string): string {
  try {
    return (document.getElementById(id) as HTMLInputElement)?.value.trim() || '';
  } catch {
    return '';
  }
}
