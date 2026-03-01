import { getWallet } from './wallet';

const STORAGE_KEY = 'clawzien_config';
const WALLET_MODE_KEY = 'clawzien_wallet_mode';

export type WalletMode = 'manual' | 'privy';

export function getWalletMode(): WalletMode {
  return (localStorage.getItem(WALLET_MODE_KEY) as WalletMode) || 'manual';
}

export function setWalletMode(mode: WalletMode): void {
  localStorage.setItem(WALLET_MODE_KEY, mode);
}

/**
 * Browser environment context injected into the system prompt.
 * Tells the agent what commands are available in the CheerpX Linux VM.
 */
export const BROWSER_ENV_CONTEXT = `## Environment

You are running in a real Linux environment (Debian i386) via CheerpX in the browser.

### Available commands
All standard Unix commands are available:
- \`jq\` — full jq binary (all features supported)
- \`curl\` — HTTP requests (bridged through browser fetch — all standard flags work)
- \`grep\`, \`sed\`, \`awk\`, \`sort\`, \`head\`, \`tail\`, \`cut\`, \`tr\`, \`wc\` — real coreutils
- \`cat\`, \`echo\`, \`ls\`, \`pwd\`, \`mkdir\`, \`cp\`, \`mv\`, \`rm\`, \`find\`, \`which\`, \`date\`, \`tee\`
- \`cast\` — Foundry-compatible: call, send, balance, storage, code, rpc, logs, abi-encode, sig, keccak, tx, receipt, block, block-number, chain-id, --to-wei, --from-wei, --to-hex, --to-dec, max-uint
- \`gcc\` — C compiler (for building tools if needed)
- \`bash\` — full bash shell with pipes, loops, conditionals, subshells

### Session Variables
All Session Variables from the skill (FACTORY, RPC, PRIVKEY, ADDRESS, etc.) are **already exported** as environment variables. Do NOT run setup commands — just use \`$FACTORY\`, \`$RPC\`, etc. directly in your commands.

### Shared tmux session
A tmux session named \`clawzien\` with window \`shared\` is attached to the user's Advanced terminal.
When the agent needs to show interactive output to the user or run long-lived commands visible to the user, use:
- \`tmux send-keys -t clawzien:shared "command here" Enter\` — type into the shared pane
- \`tmux capture-pane -t clawzien:shared -p\` — read what the user sees on screen

### Tips
- This is a real Linux environment — all standard Unix tools and shell features work
- Use pipes, loops, conditionals, and subshells freely
- Use \`cast interface <addr>\` to discover contract functions (resolves ERC1967 proxies automatically)
- Use \`cast 4byte <0xselector>\` to look up function signatures by selector
- Use \`cast logs --address <addr> --topic0 <hash> --from-block N --rpc-url $RPC\` to query event logs
`;

/**
 * Defaults come from Vite's .env injection (VITE_* vars).
 * Create web/.env from web/.env.example to pre-populate fields.
 */
const ENV_DEFAULTS = {
  apiKey:     import.meta.env.VITE_API_KEY     ?? '',
  model:      import.meta.env.VITE_MODEL       ?? 'anthropic/claude-sonnet-4-20250514',
  endpoint:   import.meta.env.VITE_ENDPOINT    ?? 'https://openrouter.ai/api/v1/chat/completions',
  privkey:    import.meta.env.VITE_PRIVKEY      ?? '',
  moltbookKey: import.meta.env.VITE_MOLTBOOK_KEY ?? '',
};

export interface AppConfig {
  apiKey: string;
  model: string;
  endpoint: string;
  skill: string;
  privkey: string;
  moltbookKey: string;
  prompt: string;
}

/** Read config from DOM inputs */
export function readConfig(): AppConfig {
  const el = (id: string) =>
    (document.getElementById(id) as HTMLInputElement).value.trim();

  let privkey = el('privkey');
  if (getWalletMode() === 'privy') {
    const w = getWallet();
    if (w) privkey = w.privateKey;
  }

  return {
    apiKey: el('api-key'),
    model: el('model'),
    endpoint: el('endpoint'),
    skill: el('skill'),
    privkey,
    moltbookKey: el('moltbook-key'),
    prompt: el('prompt'),
  };
}

/** Persist config to localStorage (secrets included — local only) */
export function saveConfig(cfg: AppConfig): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      apiKey: cfg.apiKey,
      model: cfg.model,
      endpoint: cfg.endpoint,
      skill: cfg.skill,
      privkey: cfg.privkey,
      moltbookKey: cfg.moltbookKey,
    }),
  );
}

/**
 * Restore config into DOM inputs.
 * Priority: localStorage > .env defaults > hardcoded defaults.
 */
export function restoreConfig(): void {
  const set = (id: string, val: string) => {
    const el = document.getElementById(id) as HTMLInputElement;
    if (el && val) el.value = val;
  };

  /* Merge: localStorage overrides .env defaults, but only for non-empty values */
  let merged = { ...ENV_DEFAULTS, skill: '' };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      for (const [k, v] of Object.entries(saved)) {
        if (v && typeof v === 'string') (merged as any)[k] = v;
      }
    } catch { /* ignore corrupt data */ }
  }

  set('api-key', merged.apiKey);
  set('model', merged.model);
  set('endpoint', merged.endpoint);
  set('privkey', merged.privkey);
  set('moltbook-key', merged.moltbookKey);
  if (merged.skill) {
    requestAnimationFrame(() => {
      const sel = document.getElementById('skill') as HTMLSelectElement;
      if (sel) sel.value = merged.skill;
    });
  }
}

/** Populate the skill dropdown */
export function populateSkillSelect(skills: Record<string, string>): void {
  const sel = document.getElementById('skill') as HTMLSelectElement;
  for (const name of Object.keys(skills).sort()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
}

/* writeConfigToFS removed — config is now injected into the CheerpX VM
   filesystem via cheerpx.ts:injectConfig() */
