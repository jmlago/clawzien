/**
 * curl shim — Node.js script for WebContainers.
 * Parses a subset of curl flags and uses fetch().
 */
export const CURL_SCRIPT = `#!/usr/bin/env node
const args = process.argv.slice(2);

function getFlag(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function getAllFlags(flag) {
  const vals = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      vals.push(args[++i]);
    }
  }
  return vals;
}

async function main() {
  const method = getFlag('-X') || (args.some(a => a === '-d' || a === '--data') ? 'POST' : 'GET');
  const headers = {};
  for (const h of getAllFlags('-H')) {
    const colon = h.indexOf(':');
    if (colon > 0) {
      headers[h.slice(0, colon).trim()] = h.slice(colon + 1).trim();
    }
  }

  // Read -K config file (contains -H "Header: value" lines)
  const kFile = getFlag('-K');
  if (kFile) {
    const fs = await import('fs');
    try {
      const content = fs.readFileSync(kFile, 'utf8');
      const m = content.match(/-H\\s+"([^"]+)"/g);
      if (m) {
        for (const match of m) {
          const hdr = match.replace(/-H\\s+"/, '').replace(/"$/, '');
          const colon = hdr.indexOf(':');
          if (colon > 0) {
            headers[hdr.slice(0, colon).trim()] = hdr.slice(colon + 1).trim();
          }
        }
      }
    } catch {}
  }

  let body = getFlag('-d') || getFlag('--data');
  // Handle -d @file
  if (body && body.startsWith('@')) {
    const fs = await import('fs');
    try {
      body = fs.readFileSync(body.slice(1), 'utf8');
    } catch {
      body = '';
    }
  }

  // URL is the last non-flag argument
  let url;
  for (let i = args.length - 1; i >= 0; i--) {
    if (!args[i].startsWith('-') && (i === 0 || !['--', '-X', '-H', '-d', '--data', '-K', '-o', '-m', '-s'].includes(args[i - 1]))) {
      url = args[i];
      break;
    }
  }

  if (!url) {
    console.error('curl shim: no URL provided');
    process.exit(1);
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
  });

  const text = await resp.text();
  process.stdout.write(text);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
`;
