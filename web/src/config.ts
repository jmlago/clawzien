const STORAGE_KEY = 'clawzien_config';

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
  return {
    apiKey: el('api-key'),
    model: el('model'),
    endpoint: el('endpoint'),
    skill: el('skill'),
    privkey: el('privkey'),
    moltbookKey: el('moltbook-key'),
    prompt: el('prompt'),
  };
}

/** Persist config to localStorage (no secrets stored) */
export function saveConfig(cfg: AppConfig): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      model: cfg.model,
      endpoint: cfg.endpoint,
      skill: cfg.skill,
    }),
  );
}

/** Restore saved config into DOM inputs */
export function restoreConfig(): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    const set = (id: string, val: string) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (el && val) el.value = val;
    };
    set('model', saved.model);
    set('endpoint', saved.endpoint);
    /* skill dropdown value is set after skills are loaded */
    if (saved.skill) {
      const sel = document.getElementById('skill') as HTMLSelectElement;
      if (sel) {
        /* defer until options are populated */
        requestAnimationFrame(() => {
          sel.value = saved.skill;
        });
      }
    }
  } catch { /* ignore corrupt data */ }
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

/**
 * Write config into Emscripten's MEMFS so the C code can read it.
 * Creates ~/.subzeroclaw/config, skills/, and logs/ directories.
 */
export function writeConfigToFS(
  Module: any,
  cfg: AppConfig,
  skillContent: string,
  skillName: string,
): void {
  const FS = Module.FS;
  const home = '/home/web';

  /* Create directory tree */
  const dirs = [
    home,
    `${home}/.subzeroclaw`,
    `${home}/.subzeroclaw/skills`,
    `${home}/.subzeroclaw/logs`,
    `${home}/.clawizen`,
  ];
  for (const d of dirs) {
    try { FS.mkdir(d); } catch { /* exists */ }
  }

  /* Write config file */
  const configText = [
    `api_key = "${cfg.apiKey}"`,
    `model = "${cfg.model}"`,
    `endpoint = "${cfg.endpoint}"`,
  ].join('\n');
  FS.writeFile(`${home}/.subzeroclaw/config`, configText);

  /* Write selected skill */
  const fname = skillName.replace(/\//g, '_') + '.md';
  FS.writeFile(`${home}/.subzeroclaw/skills/${fname}`, skillContent);

  /* Write private key and MoltBook key if provided */
  if (cfg.privkey) {
    FS.writeFile(`${home}/.clawizen/.privkey`, cfg.privkey);
    FS.writeFile(
      `${home}/.clawizen/wallet.json`,
      JSON.stringify({ address: '0x' }), /* placeholder — cast shim derives from privkey */
    );
  }
  if (cfg.moltbookKey) {
    FS.writeFile(`${home}/.clawizen/.moltbook_key`, cfg.moltbookKey);
  }

  /* Set HOME env */
  Module.ENV['HOME'] = home;
}
