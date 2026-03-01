/**
 * cheerpx.ts — Boot CheerpX, create filesystem mounts, connect console,
 * and expose a run() wrapper for executing commands in the VM.
 *
 * CheerpX is loaded as an ES module via the @leaningtech/cheerpx npm package.
 */

// CheerpX is dynamically imported to avoid bundling issues
// The types are declared here for the module's internal use
interface CheerpXModule {
  HttpBytesDevice: { create(url: string): Promise<unknown> };
  IDBDevice: { create(id: string): Promise<IDBDeviceInstance> };
  OverlayDevice: { create(base: unknown, overlay: unknown): Promise<unknown> };
  DataDevice: { create(): Promise<unknown> };
  Linux: { create(opts: LinuxCreateOpts): Promise<CheerpXInstance> };
}

interface LinuxCreateOpts {
  mounts: Array<{ type: string; dev?: unknown; path: string }>;
}

interface IDBDeviceInstance {
  reset(): Promise<void>;
}

export interface CheerpXInstance {
  run(cmd: string, args: string[], opts?: RunOpts): Promise<number>;
  readFileAsBlob(path: string): Promise<Blob>;
  setCustomConsole(
    writeCb: (buf: ArrayBuffer, vt: number) => void,
    cols: number,
    rows: number,
  ): (charCode: number) => void;
}

interface RunOpts {
  env?: string[];
  cwd?: string;
  uid?: number;
  gid?: number;
}

const DEFAULT_ENV = [
  'HOME=/root',
  'TERM=xterm',
  'USER=root',
  'SHELL=/bin/bash',
  'LANG=en_US.UTF-8',
  'LC_ALL=C',
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
];

const RUN_OPTS: RunOpts = {
  env: DEFAULT_ENV,
  cwd: '/root',
  uid: 0,
  gid: 0,
};

let cx: CheerpXInstance | null = null;
let idbDevice: IDBDeviceInstance | null = null;

/**
 * Boot the CheerpX VM with a persistent overlay filesystem.
 * The base image (ext2) is lazy-loaded via HTTP Range requests.
 * User writes (config, keys, skills) persist in IndexedDB across sessions.
 */
export async function boot(
  imageUrl: string,
  onProgress?: (msg: string) => void,
): Promise<CheerpXInstance> {
  onProgress?.('Loading CheerpX runtime...');
  const CX = await import(/* @vite-ignore */ '@leaningtech/cheerpx') as unknown as CheerpXModule;

  onProgress?.('Loading disk image...');
  const httpDevice = await CX.HttpBytesDevice.create(imageUrl);

  onProgress?.('Setting up persistent storage...');
  idbDevice = await CX.IDBDevice.create('clawzien-persist');
  const overlayDevice = await CX.OverlayDevice.create(httpDevice, idbDevice);
  const dataDevice = await CX.DataDevice.create();

  onProgress?.('Creating Linux VM...');
  cx = await CX.Linux.create({
    mounts: [
      { type: 'ext2', dev: overlayDevice, path: '/' },
      { type: 'dir', dev: dataDevice, path: '/data' },
      { type: 'devs', path: '/dev' },
      { type: 'devpts', path: '/dev/pts' },
      { type: 'proc', path: '/proc' },
    ],
  });

  // Ensure bridge directories exist
  await cx.run('/bin/bash', ['-c', 'mkdir -p /tmp/bridge/requests /tmp/bridge/responses'], RUN_OPTS);

  // Clean stale tmux sockets (persistent IndexedDB may carry old ones)
  await cx.run('/bin/bash', ['-c', 'rm -rf /tmp/tmux-* 2>/dev/null || true'], RUN_OPTS);

  onProgress?.('VM ready.');
  return cx;
}

/** Get the CheerpX instance (must be booted first) */
export function getInstance(): CheerpXInstance {
  if (!cx) throw new Error('CheerpX not booted');
  return cx;
}

/** Connect an xterm.js Terminal to the CheerpX console */
export function connectConsole(
  writeCb: (buf: ArrayBuffer, vt: number) => void,
  cols: number,
  rows: number,
): (charCode: number) => void {
  if (!cx) throw new Error('CheerpX not booted');
  return cx.setCustomConsole(writeCb, cols, rows);
}

/** Run a bash command in the VM and return the exit code */
export async function run(cmd: string, args: string[] = [], extraEnv: string[] = []): Promise<number> {
  if (!cx) throw new Error('CheerpX not booted');
  return cx.run(cmd, args, {
    ...RUN_OPTS,
    env: [...DEFAULT_ENV, ...extraEnv],
  });
}

/** Run a bash -c command and capture output via a temp file */
export async function exec(shellCmd: string, extraEnv: string[] = []): Promise<string> {
  if (!cx) throw new Error('CheerpX not booted');

  const tmpOut = `/tmp/.cx_exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await cx.run('/bin/bash', ['-c', `${shellCmd} > ${tmpOut} 2>&1`], {
    ...RUN_OPTS,
    env: [...DEFAULT_ENV, ...extraEnv],
  });

  try {
    const blob = await cx.readFileAsBlob(tmpOut);
    const text = await blob.text();
    // Cleanup
    cx.run('/bin/bash', ['-c', `rm -f ${tmpOut}`], RUN_OPTS).catch(() => {});
    return text;
  } catch {
    return '';
  }
}

/** Write a file into the VM filesystem */
export async function writeFile(path: string, content: string): Promise<void> {
  if (!cx) throw new Error('CheerpX not booted');
  // Use base64 to avoid shell escaping issues with arbitrary content
  const b64 = btoa(unescape(encodeURIComponent(content)));
  await cx.run('/bin/bash', ['-c',
    `mkdir -p "$(dirname '${path}')" && echo '${b64}' | base64 -d > '${path}'`,
  ], RUN_OPTS);
}

/** Read a file from the VM filesystem */
export async function readFile(path: string): Promise<string> {
  if (!cx) throw new Error('CheerpX not booted');
  try {
    const blob = await cx.readFileAsBlob(path);
    return await blob.text();
  } catch {
    return '';
  }
}

/**
 * Inject config, skills, and keys into the VM filesystem.
 * Replaces the old writeConfigToFS (MEMFS) approach.
 */
export async function injectConfig(cfg: {
  apiKey: string;
  model: string;
  endpoint: string;
  skillContent: string;
  skillName: string;
  envContext: string;
  privkey?: string;
  moltbookKey?: string;
  walletAddress?: string;
}): Promise<void> {
  if (!cx) throw new Error('CheerpX not booted');

  // Write config file
  const configText = [
    `api_key = "${cfg.apiKey}"`,
    `model = "${cfg.model}"`,
    `endpoint = "${cfg.endpoint}"`,
  ].join('\n');
  await writeFile('/root/.subzeroclaw/config', configText);

  // Write selected skill
  const fname = cfg.skillName.replace(/\//g, '_') + '.md';
  await writeFile(`/root/.subzeroclaw/skills/${fname}`, cfg.skillContent);

  // Write browser environment context
  await writeFile('/root/.subzeroclaw/skills/_browser_env.md', cfg.envContext);

  // Write private key and wallet info
  if (cfg.privkey) {
    await writeFile('/root/.clawizen/.privkey', cfg.privkey);
    await writeFile('/root/.clawizen/wallet.json',
      JSON.stringify({ address: cfg.walletAddress || '0x' }));
  }

  // Write MoltBook key
  if (cfg.moltbookKey) {
    await writeFile('/root/.clawizen/.moltbook_key', cfg.moltbookKey);
  }

  // Set env vars via /etc/environment (persists for all bash sessions)
  const envLines = [
    `SUBZEROCLAW_API_KEY="${cfg.apiKey}"`,
    `SUBZEROCLAW_MODEL="${cfg.model}"`,
    `SUBZEROCLAW_ENDPOINT="${cfg.endpoint}"`,
  ];
  await writeFile('/etc/environment', envLines.join('\n'));
}

/** Reset the VM's persistent storage (clear IndexedDB) */
export async function resetVM(): Promise<void> {
  if (idbDevice) {
    await idbDevice.reset();
  }
}

/** Derive an Ethereum address from a private key using cast-native or openssl */
export async function deriveAddress(privkey: string): Promise<string> {
  if (!cx) throw new Error('CheerpX not booted');

  // Try using cast-native if available
  const result = await exec(
    `if [ -x /usr/local/bin/cast-native ]; then
       /usr/local/bin/cast-native wallet address --private-key '${privkey}' 2>/dev/null
     else
       echo ""
     fi`,
  );

  const addr = result.trim();
  if (addr && addr.startsWith('0x')) return addr;

  // Fallback: we can't derive locally without cast — return empty
  // (main.ts will use cast-browser.ts as fallback)
  return '';
}
