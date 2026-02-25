import { WebContainer } from '@webcontainer/api';
import { CAST_SCRIPT } from './shims/cast';
import { CURL_SCRIPT } from './shims/curl';
import { JQ_SCRIPT } from './shims/jq';

let wc: WebContainer;

export async function boot(): Promise<WebContainer> {
  wc = await WebContainer.boot();

  /* Create project structure with shims and package.json */
  await wc.mount({
    'package.json': {
      file: {
        contents: JSON.stringify({
          name: 'clawzien-runtime',
          private: true,
          type: 'module',
          dependencies: { viem: '^2.21.0', 'molly-cli': '*' },
        }),
      },
    },
    bin: {
      directory: {
        cast: { file: { contents: CAST_SCRIPT } },
        curl: { file: { contents: CURL_SCRIPT } },
        jq:   { file: { contents: JQ_SCRIPT } },
      },
    },
  });

  /* Make shims executable */
  for (const name of ['cast', 'curl', 'jq']) {
    await spawn('chmod', ['+x', `bin/${name}`]);
  }

  return wc;
}

export async function installDeps(
  onLog: (msg: string) => void,
): Promise<void> {
  onLog('Installing dependencies (viem + molly-cli)...\r\n');
  await spawn('npm', ['install'], onLog);
}

/** Write clawzien runtime files into the WebContainers FS */
export async function writeRuntimeFiles(opts: {
  privkey?: string;
  moltbookKey?: string;
  walletAddress?: string;
}): Promise<void> {
  await wc.mount({
    home: {
      directory: {
        web: {
          directory: {
            '.clawizen': {
              directory: {
                ...(opts.privkey
                  ? { '.privkey': { file: { contents: opts.privkey } } }
                  : {}),
                ...(opts.moltbookKey
                  ? { '.moltbook_key': { file: { contents: opts.moltbookKey } } }
                  : {}),
                ...(opts.walletAddress
                  ? {
                      'wallet.json': {
                        file: {
                          contents: JSON.stringify({ address: opts.walletAddress }),
                        },
                      },
                    }
                  : {}),
              },
            },
          },
        },
      },
    },
  });
}

/** Execute a shell command inside WebContainers and return combined output */
export async function exec(cmd: string): Promise<string> {
  /* Prepend our bin/ to PATH so cast/curl/jq shims are found */
  const envCmd = `export PATH="/home/web/bin:./bin:./node_modules/.bin:$PATH" HOME=/home/web; ${cmd}`;

  const proc = await wc.spawn('sh', ['-c', envCmd]);

  const chunks: string[] = [];

  const stdout = proc.output.getReader();
  for (;;) {
    const { done, value } = await stdout.read();
    if (done) break;
    chunks.push(value);
  }

  await proc.exit;
  return chunks.join('');
}

/** Low-level spawn helper that waits for exit */
async function spawn(
  command: string,
  args: string[],
  onLog?: (msg: string) => void,
): Promise<number> {
  const proc = await wc.spawn(command, args);

  const reader = proc.output.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (onLog) onLog(value);
  }

  return proc.exit;
}

export function getWebContainer(): WebContainer {
  return wc;
}
