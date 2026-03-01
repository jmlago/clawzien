import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const STORAGE_KEY = 'clawzien_wallet';

export interface Wallet {
  privateKey: string;
  address: string;
}

/** Generate a new wallet and persist to localStorage. */
export function generateWallet(): Wallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const wallet: Wallet = { privateKey, address: account.address };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  return wallet;
}

/** Return stored wallet or null. */
export function getWallet(): Wallet | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const w = JSON.parse(raw) as Wallet;
    if (w.privateKey && w.address) return w;
  } catch { /* ignore corrupt data */ }
  return null;
}

/** Remove wallet from localStorage. */
export function clearWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
}
