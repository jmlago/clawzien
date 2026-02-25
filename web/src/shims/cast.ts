/**
 * cast shim — Node.js script for WebContainers.
 * Translates Foundry's `cast` CLI subset to viem RPC calls.
 *
 * Supported:
 *   cast call <addr> "sig(inputs)(outputs)" [args...] --rpc-url <url>
 *   cast send <addr> "sig(inputs)" [args...] --private-key <key> --rpc-url <url>
 *   cast balance <addr> --rpc-url <url> [--ether]
 *   cast --to-wei <n> [unit]
 *   cast --from-wei <n> [unit]
 *   cast max-uint
 */
export const CAST_SCRIPT = `#!/usr/bin/env node
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  formatUnits,
  parseUnits,
  maxUint256,
  decodeAbiParameters,
  encodeFunctionData,
  decodeFunctionResult,
  getAddress,
  hexToBigInt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const args = process.argv.slice(2);

/**
 * Parse Foundry signature "funcName(inputTypes)(returnTypes)"
 * into viem ABI item.
 */
function parseSig(sig) {
  // Handle tuple arrays like (address,string,uint256,uint256)[]
  const m = sig.match(/^(\\w+)\\((.*)\\)(?:\\((.*)\\))?$/);
  if (!m) {
    throw new Error('Cannot parse signature: ' + sig);
  }
  const [, name, rawInputs, rawOutputs] = m;

  function splitTopLevel(s) {
    if (!s || !s.trim()) return [];
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    parts.push(current.trim());
    return parts.filter(Boolean);
  }

  function parseType(t) {
    // Handle tuple types: (type1,type2)[] or (type1,type2)
    const tupleMatch = t.match(/^\\((.+)\\)(\\[\\])?$/);
    if (tupleMatch) {
      const innerTypes = splitTopLevel(tupleMatch[1]);
      const isArray = !!tupleMatch[2];
      const components = innerTypes.map((it, i) => ({
        name: 'v' + i,
        ...parseType(it),
      }));
      return {
        type: isArray ? 'tuple[]' : 'tuple',
        components,
      };
    }
    return { type: t };
  }

  const inputs = splitTopLevel(rawInputs).map((t, i) => ({
    name: 'arg' + i,
    ...parseType(t),
  }));

  const outputs = rawOutputs
    ? splitTopLevel(rawOutputs).map((t, i) => ({
        name: 'out' + i,
        ...parseType(t),
      }))
    : [];

  return {
    type: 'function',
    name,
    inputs,
    outputs,
    stateMutability: 'view',
  };
}

/** Extract a --flag value from args array */
function getFlag(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(flag) {
  return args.indexOf(flag) !== -1;
}

/** Format a single decoded value for cast-like output */
function formatValue(v) {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v.toString();
  if (Array.isArray(v)) {
    // Array of tuples or primitives
    return '[' + v.map(item => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        // Tuple: output each field
        const vals = Object.values(item).map(formatValue);
        return '(' + vals.join(', ') + ')';
      }
      return formatValue(item);
    }).join(', ') + ']';
  }
  if (typeof v === 'object' && v !== null) {
    const vals = Object.values(v).map(formatValue);
    return '(' + vals.join(', ') + ')';
  }
  return String(v);
}

async function main() {
  const subcmd = args[0];

  /* ── cast max-uint ─────────────────────────────────── */
  if (subcmd === 'max-uint') {
    console.log(maxUint256.toString());
    return;
  }

  /* ── cast --to-wei <n> [unit] ──────────────────────── */
  if (subcmd === '--to-wei') {
    const val = args[1];
    const unit = args[2] || 'ether';
    const decimals = unit === 'gwei' ? 9 : unit === 'ether' ? 18 : parseInt(unit) || 18;
    console.log(parseUnits(val, decimals).toString());
    return;
  }

  /* ── cast --from-wei <n> [unit] ────────────────────── */
  if (subcmd === '--from-wei') {
    const val = args[1];
    const unit = args[2] || 'ether';
    const decimals = unit === 'gwei' ? 9 : unit === 'ether' ? 18 : parseInt(unit) || 18;
    console.log(formatUnits(BigInt(val), decimals));
    return;
  }

  /* ── cast balance <addr> --rpc-url <url> [--ether] ── */
  if (subcmd === 'balance') {
    const addr = getAddress(args[1]);
    const rpc = getFlag('--rpc-url');
    const client = createPublicClient({ transport: http(rpc) });
    const bal = await client.getBalance({ address: addr });
    console.log(hasFlag('--ether') ? formatEther(bal) : bal.toString());
    return;
  }

  /* ── cast call <addr> "sig" [args...] --rpc-url <url> */
  if (subcmd === 'call') {
    const addr = getAddress(args[1]);
    const sig = args[2];
    const rpc = getFlag('--rpc-url');
    const abi = parseSig(sig);

    // Collect positional args (between sig and first --flag)
    const callArgs = [];
    for (let i = 3; i < args.length; i++) {
      if (args[i].startsWith('--')) break;
      callArgs.push(args[i]);
    }

    // Coerce args to expected types
    const coerced = abi.inputs.map((inp, i) => {
      const raw = callArgs[i];
      if (!raw) return undefined;
      if (inp.type === 'uint256' || inp.type === 'int256') return BigInt(raw);
      if (inp.type === 'bool') return raw === 'true';
      if (inp.type === 'address') return getAddress(raw);
      return raw;
    }).filter(v => v !== undefined);

    const client = createPublicClient({ transport: http(rpc) });
    const data = encodeFunctionData({
      abi: [abi],
      functionName: abi.name,
      args: coerced,
    });

    const result = await client.call({ to: addr, data });

    // Decode result
    if (result.data && abi.outputs.length > 0) {
      const decoded = decodeFunctionResult({
        abi: [abi],
        functionName: abi.name,
        data: result.data,
      });

      if (Array.isArray(decoded)) {
        for (const v of decoded) console.log(formatValue(v));
      } else {
        console.log(formatValue(decoded));
      }
    } else {
      console.log(result.data || '0x');
    }
    return;
  }

  /* ── cast send <addr> "sig" [args...] --private-key <key> --rpc-url <url> */
  if (subcmd === 'send') {
    const addr = getAddress(args[1]);
    const sig = args[2];
    const rpc = getFlag('--rpc-url');
    const pk = getFlag('--private-key');

    const abi = parseSig(sig);

    const callArgs = [];
    for (let i = 3; i < args.length; i++) {
      if (args[i].startsWith('--')) break;
      callArgs.push(args[i]);
    }

    const coerced = abi.inputs.map((inp, i) => {
      const raw = callArgs[i];
      if (!raw) return undefined;
      if (inp.type === 'uint256' || inp.type === 'int256') return BigInt(raw);
      if (inp.type === 'bool') return raw === 'true';
      if (inp.type === 'address') return getAddress(raw);
      return raw;
    }).filter(v => v !== undefined);

    const account = privateKeyToAccount(pk);
    const client = createWalletClient({
      account,
      transport: http(rpc),
    });
    const publicClient = createPublicClient({ transport: http(rpc) });

    const data = encodeFunctionData({
      abi: [abi],
      functionName: abi.name,
      args: coerced,
    });

    const hash = await client.sendTransaction({
      to: addr,
      data,
      chain: null,
    });

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log('blockNumber     ' + receipt.blockNumber);
    console.log('transactionHash ' + receipt.transactionHash);
    console.log('status          ' + (receipt.status === 'success' ? '1' : '0'));
    console.log('gasUsed         ' + receipt.gasUsed);
    return;
  }

  console.error('cast shim: unsupported command: ' + args.join(' '));
  process.exit(1);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
`;
