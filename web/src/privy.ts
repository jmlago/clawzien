import PrivyClient, { LocalStorage } from '@privy-io/js-sdk-core';

let privy: InstanceType<typeof PrivyClient> | null = null;

/** Initialize Privy. Returns false if no app ID configured. */
export async function init(): Promise<boolean> {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  if (!appId) return false;

  privy = new PrivyClient({
    appId,
    storage: new LocalStorage(),
  });
  return true;
}

function ensurePrivy(): InstanceType<typeof PrivyClient> {
  if (!privy) throw new Error('Privy not initialized');
  return privy;
}

/** Start Google OAuth login (redirect-based). */
export async function login(): Promise<void> {
  const p = ensurePrivy();
  const redirectURI = `${window.location.origin}${window.location.pathname}`;
  const { url } = await p.auth.oauth.generateURL('google', redirectURI);
  window.location.assign(url);
}

/** Complete OAuth login after redirect. Returns true if handled. */
export async function handleOAuthCallback(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('privy_oauth_code');
  const state = params.get('privy_oauth_state');
  if (!code || !state) return false;

  const p = ensurePrivy();
  await p.auth.oauth.loginWithCode(code, state, 'google');

  // Clean up URL params
  const url = new URL(window.location.href);
  url.searchParams.delete('privy_oauth_code');
  url.searchParams.delete('privy_oauth_state');
  window.history.replaceState({}, '', url.toString());

  return true;
}

/** Check if user is authenticated. */
export async function isAuthenticated(): Promise<boolean> {
  const p = ensurePrivy();
  const token = await p.getAccessToken();
  return token !== null;
}

/** Get current user or null. */
export async function getUser() {
  const p = ensurePrivy();
  try {
    const { user } = await p.user.get();
    return user;
  } catch {
    return null;
  }
}

/** Logout. */
export async function logout(): Promise<void> {
  const p = ensurePrivy();
  await p.auth.logout();
}

/** Open MoonPay onramp targeting the given wallet address. */
export async function fundWallet(address: string): Promise<void> {
  const p = ensurePrivy();
  const { signedUrl } = await p.funding.moonpay.sign({
    address,
    config: {
      currencyCode: 'ETH_BASE',
      uiConfig: { theme: 'dark' },
    },
  });
  window.open(signedUrl, '_blank');
}
