/**
 * Browser-context cast implementation using viem.
 * Runs in the main browser thread so fetch() works for all APIs.
 * Called from bridge.ts for network-dependent cast commands from the VM.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  formatUnits,
  parseUnits,
  maxUint256,
  encodeFunctionData,
  decodeFunctionResult,
  decodeAbiParameters,
  getAddress,
  keccak256,
  toHex,
  hexToBigInt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** Parse Foundry-style signature "func(inputs)(outputs)" into a viem ABI item */
function parseSig(sig: string) {
  const m = sig.match(/^(\w+)\((.*?)\)(?:\((.*)\))?$/);
  if (!m) throw new Error('Cannot parse signature: ' + sig);
  const [, name, rawInputs, rawOutputs] = m;

  function splitTopLevel(s: string): string[] {
    if (!s?.trim()) return [];
    const parts: string[] = [];
    let depth = 0, current = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; }
      else current += ch;
    }
    parts.push(current.trim());
    return parts.filter(Boolean);
  }

  function parseType(t: string): any {
    const tupleMatch = t.match(/^\((.+)\)(\[\])?$/);
    if (tupleMatch) {
      const innerTypes = splitTopLevel(tupleMatch[1]);
      return {
        type: tupleMatch[2] ? 'tuple[]' : 'tuple',
        components: innerTypes.map((it, i) => ({ name: 'v' + i, ...parseType(it) })),
      };
    }
    return { type: t };
  }

  const inputs = splitTopLevel(rawInputs).map((t, i) => ({ name: 'arg' + i, ...parseType(t) }));
  const outputs = rawOutputs
    ? splitTopLevel(rawOutputs).map((t, i) => ({ name: 'out' + i, ...parseType(t) }))
    : [];

  return { type: 'function' as const, name, inputs, outputs, stateMutability: 'view' as const };
}

/** Format a decoded value for cast-like output */
function formatValue(v: any): string {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v.toString();
  if (Array.isArray(v)) {
    return '[' + v.map(item => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        return '(' + Object.values(item).map(formatValue).join(', ') + ')';
      }
      return formatValue(item);
    }).join(', ') + ']';
  }
  if (typeof v === 'object' && v !== null) {
    return '(' + Object.values(v).map(formatValue).join(', ') + ')';
  }
  return String(v);
}

/** Coerce string args to the expected ABI types */
function coerceArgs(inputs: any[], rawArgs: string[]): any[] {
  return inputs.map((inp, i) => {
    const raw = rawArgs[i];
    if (raw === undefined) return undefined;
    if (/^u?int\d*$/.test(inp.type)) return BigInt(raw);
    if (inp.type === 'bool') return raw === 'true';
    if (inp.type === 'address') return getAddress(raw);
    return raw;
  }).filter(v => v !== undefined);
}

/** Parse args array: extract --flag values and positional args */
function parseArgs(args: string[]) {
  function getFlag(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return (idx !== -1 && idx + 1 < args.length) ? args[idx + 1] : undefined;
  }
  function hasFlag(flag: string): boolean {
    return args.includes(flag);
  }
  return { getFlag, hasFlag };
}

/**
 * Execute a cast command in the browser context.
 * Returns the output string, or null if the subcommand isn't recognized.
 */
export async function executeCast(args: string[]): Promise<string | null> {
  const subcmd = args[0];
  const { getFlag, hasFlag } = parseArgs(args);

  // Collect positional args (between subcmd+sig and first --flag)
  function positionalArgs(startIdx: number): string[] {
    const result: string[] = [];
    for (let i = startIdx; i < args.length; i++) {
      if (args[i].startsWith('--')) break;
      result.push(args[i]);
    }
    return result;
  }

  /* ── cast call <addr> "sig" [args...] --rpc-url <url> ── */
  if (subcmd === 'call') {
    const addr = getAddress(args[1]);
    const sig = args[2];
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const abi = parseSig(sig);
    const callArgs = positionalArgs(3);
    const coerced = coerceArgs(abi.inputs, callArgs);

    const client = createPublicClient({ transport: http(rpc) });
    const data = encodeFunctionData({ abi: [abi], functionName: abi.name, args: coerced });
    const result = await client.call({ to: addr, data });

    if (result.data && abi.outputs.length > 0) {
      try {
        const decoded = decodeFunctionResult({ abi: [abi], functionName: abi.name, data: result.data });
        if (Array.isArray(decoded)) return decoded.map(formatValue).join('\n');
        return formatValue(decoded);
      } catch {
        try {
          const decoded = decodeAbiParameters(abi.outputs, result.data);
          return [...decoded].map(formatValue).join('\n');
        } catch {
          return result.data;
        }
      }
    }
    return result.data || '0x';
  }

  /* ── cast send <addr> "sig" [args...] --private-key <key> --rpc-url <url> ── */
  if (subcmd === 'send') {
    const addr = getAddress(args[1]);
    const sig = args[2];
    const rpc = getFlag('--rpc-url');
    const pk = getFlag('--private-key');
    if (!rpc || !pk) return 'Error: --rpc-url and --private-key required';
    const abi = parseSig(sig);
    const callArgs = positionalArgs(3);
    const coerced = coerceArgs(abi.inputs, callArgs);

    const account = privateKeyToAccount(pk as `0x${string}`);
    const walletClient = createWalletClient({ account, transport: http(rpc) });
    const publicClient = createPublicClient({ transport: http(rpc) });

    const data = encodeFunctionData({ abi: [abi], functionName: abi.name, args: coerced });
    const hash = await walletClient.sendTransaction({ to: addr, data, chain: null });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return [
      'blockNumber     ' + receipt.blockNumber,
      'transactionHash ' + receipt.transactionHash,
      'status          ' + (receipt.status === 'success' ? '1' : '0'),
      'gasUsed         ' + receipt.gasUsed,
    ].join('\n');
  }

  /* ── cast balance <addr> --rpc-url <url> [--ether] ── */
  if (subcmd === 'balance') {
    const addr = getAddress(args[1]);
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const client = createPublicClient({ transport: http(rpc) });
    const bal = await client.getBalance({ address: addr });
    return hasFlag('--ether') ? formatEther(bal) : bal.toString();
  }

  /* ── cast block-number --rpc-url <url> ── */
  if (subcmd === 'block-number') {
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const client = createPublicClient({ transport: http(rpc) });
    return (await client.getBlockNumber()).toString();
  }

  /* ── cast block [tag|number] --rpc-url <url> ── */
  if (subcmd === 'block') {
    const tag = args[1] || 'latest';
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const client = createPublicClient({ transport: http(rpc) });
    const opts = /^\d+$/.test(tag) ? { blockNumber: BigInt(tag) } : { blockTag: tag as any };
    const block = await client.getBlock(opts);
    return [
      'baseFeePerGas        ' + (block.baseFeePerGas || ''),
      'gasLimit             ' + block.gasLimit,
      'gasUsed              ' + block.gasUsed,
      'hash                 ' + block.hash,
      'number               ' + block.number,
      'timestamp            ' + block.timestamp,
    ].join('\n');
  }

  /* ── cast chain-id --rpc-url <url> ── */
  if (subcmd === 'chain-id') {
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const client = createPublicClient({ transport: http(rpc) });
    return (await client.getChainId()).toString();
  }

  /* ── cast storage <addr> <slot> --rpc-url <url> ── */
  if (subcmd === 'storage') {
    const addr = getAddress(args[1]);
    const slot = args[2] as `0x${string}`;
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const client = createPublicClient({ transport: http(rpc) });
    return (await client.getStorageAt({ address: addr, slot })) || '0x0';
  }

  /* ── cast code <addr> --rpc-url <url> ── */
  if (subcmd === 'code') {
    const addr = getAddress(args[1]);
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const client = createPublicClient({ transport: http(rpc) });
    return (await client.getCode({ address: addr })) || '0x';
  }

  /* ── cast tx <hash> --rpc-url <url> ── */
  if (subcmd === 'tx') {
    const hash = args[1] as `0x${string}`;
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const client = createPublicClient({ transport: http(rpc) });
    const tx = await client.getTransaction({ hash });
    return [
      'blockNumber     ' + tx.blockNumber,
      'from            ' + tx.from,
      'to              ' + tx.to,
      'value           ' + tx.value,
      'gas             ' + tx.gas,
      'input           ' + tx.input,
    ].join('\n');
  }

  /* ── cast receipt <hash> --rpc-url <url> ── */
  if (subcmd === 'receipt') {
    const hash = args[1] as `0x${string}`;
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const client = createPublicClient({ transport: http(rpc) });
    const receipt = await client.getTransactionReceipt({ hash });
    return [
      'blockNumber     ' + receipt.blockNumber,
      'transactionHash ' + receipt.transactionHash,
      'status          ' + (receipt.status === 'success' ? '1' : '0'),
      'gasUsed         ' + receipt.gasUsed,
      'logs            ' + receipt.logs.length,
    ].join('\n');
  }

  /* ── cast max-uint ── */
  if (subcmd === 'max-uint') return maxUint256.toString();

  /* ── cast --to-wei <n> [unit] ── */
  if (subcmd === '--to-wei') {
    const val = args[1];
    const unit = args[2] || 'ether';
    const decimals = unit === 'gwei' ? 9 : unit === 'ether' ? 18 : parseInt(unit) || 18;
    return parseUnits(val, decimals).toString();
  }

  /* ── cast --from-wei <n> [unit] ── */
  if (subcmd === '--from-wei') {
    const val = args[1];
    const unit = args[2] || 'ether';
    const decimals = unit === 'gwei' ? 9 : unit === 'ether' ? 18 : parseInt(unit) || 18;
    return formatUnits(BigInt(val), decimals);
  }

  /* ── cast --to-hex <n> ── */
  if (subcmd === '--to-hex') return '0x' + BigInt(args[1]).toString(16);

  /* ── cast --to-dec <hex> ── */
  if (subcmd === '--to-dec') return hexToBigInt(args[1] as `0x${string}`).toString();

  /* ── cast abi-encode "sig" [args...] ── */
  if (subcmd === 'abi-encode') {
    const sig = args[1];
    const abi = parseSig(sig);
    const callArgs = positionalArgs(2);
    const coerced = coerceArgs(abi.inputs, callArgs);
    return encodeFunctionData({ abi: [abi], functionName: abi.name, args: coerced });
  }

  /* ── cast sig "funcSig" ── */
  if (subcmd === 'sig') {
    return keccak256(toHex(args[1] || '')).slice(0, 10);
  }

  /* ── cast keccak / keccak256 "text" ── */
  if (subcmd === 'keccak' || subcmd === 'keccak256') {
    return keccak256(toHex(args[1] || ''));
  }

  /* ── cast logs --address <addr> [--topic0 <t>] [--from-block N] [--to-block N] --rpc-url <url> ── */
  if (subcmd === 'logs') {
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const address = getFlag('--address');
    const topic0 = getFlag('--topic0');
    let fromBlock = getFlag('--from-block');
    let toBlock = getFlag('--to-block');

    // Auto-clamp to 10,000 block range to avoid RPC limits
    const MAX_RANGE = 9999;
    const latestResp = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    const latestJson = await latestResp.json();
    const latestBlock = BigInt(latestJson.result || '0x0');

    let from = fromBlock && /^\d+$/.test(fromBlock) ? BigInt(fromBlock) : BigInt(0);
    let to = toBlock && /^\d+$/.test(toBlock) ? BigInt(toBlock) : latestBlock;
    if (to - from > MAX_RANGE) {
      from = to - BigInt(MAX_RANGE);
    }

    const params: any = {};
    if (address) params.address = address;
    if (topic0) params.topics = [topic0];
    params.fromBlock = '0x' + from.toString(16);
    params.toBlock = '0x' + to.toString(16);

    const resp = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [params] }),
    });
    const json = await resp.json();
    if (json.error) return 'Error: ' + (json.error.message || JSON.stringify(json.error));
    const logs = json.result || [];
    if (logs.length === 0) return 'No logs found (searched blocks ' + from.toString() + ' to ' + to.toString() + ')';
    return logs.map((log: any) => [
      'address          ' + log.address,
      'blockNumber      ' + (log.blockNumber ? BigInt(log.blockNumber).toString() : ''),
      'transactionHash  ' + log.transactionHash,
      'topics           ' + JSON.stringify(log.topics),
      'data             ' + log.data,
      '',
    ].join('\n')).join('\n');
  }

  /* ── cast rpc <method> [params...] --rpc-url <url> ── */
  if (subcmd === 'rpc') {
    const method = args[1];
    const rpc = getFlag('--rpc-url');
    if (!rpc) return 'Error: --rpc-url required';
    const params: any[] = [];
    for (let i = 2; i < args.length; i++) {
      if (args[i].startsWith('--')) break;
      try { params.push(JSON.parse(args[i])); }
      catch { params.push(args[i]); }
    }
    const resp = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = await resp.json();
    if (json.error) return 'Error: ' + (json.error.message || JSON.stringify(json.error));
    return typeof json.result === 'string' ? json.result : JSON.stringify(json.result, null, 2);
  }

  // Not recognized — return null so bridge caller can report error
  return null;
}
