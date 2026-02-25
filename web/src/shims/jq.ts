/**
 * jq shim — Node.js script for WebContainers.
 * Reads JSON from stdin, evaluates simple field expressions.
 */
export const JQ_SCRIPT = `#!/usr/bin/env node
const args = process.argv.slice(2);
const rawMode = args.includes('-r');
const filter = args.find(a => !a.startsWith('-')) || '.';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function evaluate(obj, expr) {
  if (expr === '.') return obj;

  // Split by . but respect brackets
  const parts = [];
  let current = '';
  let depth = 0;
  for (const ch of expr) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === '.' && depth === 0 && current) {
      parts.push(current);
      current = '';
    } else if (ch !== '.' || depth > 0 || current) {
      current += ch;
    }
  }
  if (current) parts.push(current);

  let result = obj;
  for (const part of parts) {
    if (result === null || result === undefined) return null;

    // Array index: [0]
    const arrMatch = part.match(/^(\\w*)\\[(\\d+)\\]$/);
    if (arrMatch) {
      if (arrMatch[1]) result = result[arrMatch[1]];
      result = result[parseInt(arrMatch[2])];
      continue;
    }

    // Array iterator: .[] or field.[]
    if (part === '[]' || part.endsWith('[]')) {
      const field = part.replace(/\\[\\]$/, '');
      if (field) result = result[field];
      // Return array elements will be handled below
      if (Array.isArray(result)) return result;
      continue;
    }

    result = result[part];
  }
  return result;
}

function output(val) {
  if (val === null || val === undefined) {
    console.log('null');
  } else if (typeof val === 'string' && rawMode) {
    console.log(val);
  } else {
    console.log(JSON.stringify(val, null, 2));
  }
}

async function main() {
  const input = await readStdin();
  if (!input.trim()) return;

  const data = JSON.parse(input);
  const result = evaluate(data, filter);

  if (Array.isArray(result) && (filter.endsWith('[]') || filter.endsWith('[]'))) {
    for (const item of result) output(item);
  } else {
    output(result);
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
`;
