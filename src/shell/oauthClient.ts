/**
 * oauthClient.ts — OAuth sign-in for Solander.
 *
 * Provides an abstraction over two redirect strategies:
 * 1. Deep-link: opens system browser, server redirects to solander://auth/callback
 * 2. Loopback: opens system browser, server redirects to http://127.0.0.1:<port>/callback
 *
 * The Chatto server is the OAuth client — it redirects back to the web client
 * after the user authenticates. Solander intercepts that redirect and extracts
 * the authorization code, then exchanges it for a bearer token.
 */

import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';

export type OAuthStrategy = 'deep-link' | 'loopback';

export type OAuthResult = {
  success: true;
  token: string;
  serverUrl: string;
} | {
  success: false;
  error: string;
};

/**
 * Start the OAuth flow for a given server.
 *
 * Opens the system browser at the server's login URL and waits for the
 * redirect callback. The strategy is selected based on the server's
 * redirect URI capabilities.
 *
 * @param serverUrl - The Chatto server base URL
 * @param loginUrl - The OAuth login URL from the server's discovery response
 * @param strategy - Which redirect strategy to use
 * @returns The OAuth result with the bearer token
 */
export async function startOAuthFlow(
  serverUrl: string,
  loginUrl: string,
  strategy: OAuthStrategy = 'deep-link',
): Promise<OAuthResult> {
  try {
    if (strategy === 'deep-link') {
      return await deepLinkFlow(serverUrl, loginUrl);
    } else {
      return await loopbackFlow(serverUrl, loginUrl);
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'OAuth flow failed',
    };
  }
}

/**
 * Deep-link OAuth strategy.
 *
 * 1. Opens the system browser at the server's login URL
 * 2. Server redirects to solander://auth/callback?code=...&state=...
 * 3. The deep-link plugin captures the callback
 * 4. The code is exchanged for a bearer token
 */
async function deepLinkFlow(
  serverUrl: string,
  loginUrl: string,
): Promise<OAuthResult> {
  // Validate the login URL
  try {
    new URL(loginUrl);
  } catch {
    return { success: false, error: 'Invalid login URL' };
  }
  // Set up a promise that resolves when the deep-link callback arrives
  const callbackPromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('OAuth timed out after 5 minutes'));
    }, 5 * 60 * 1000);

    // Listen for warm-start deep links (app already running)
    const unlisten = onOpenUrl((urls: string[]) => {
      for (const url of urls) {
        if (url.startsWith('solander://auth/callback')) {
          clearTimeout(timeout);
          unlisten.then((fn: () => void) => fn());
          resolve(url);
          return;
        }
      }
    });

    // Also check for cold-start deep link (app launched via URL)
    getCurrent().then((url: string | null) => {
      if (url && url.startsWith('solander://auth/callback')) {
        clearTimeout(timeout);
        resolve(url);
      }
    }).catch(() => {
      // No cold-start deep link — that's fine
    });
  });

  // Open the system browser at the login URL
  await openUrl(loginUrl);

  // Wait for the callback
  const callbackUrl = await callbackPromise;

  // Extract the authorization code from the callback URL
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return { success: false, error: 'Invalid callback URL' };
  }
  const code = parsed.searchParams.get('code');
  const error = parsed.searchParams.get('error');

  if (error) {
    return { success: false, error: `OAuth error: ${error}` };
  }

  if (!code) {
    return { success: false, error: 'No authorization code in callback' };
  }

  // Exchange the code for a token via the server
  return await exchangeCode(serverUrl, code);
}

/**
 * Loopback OAuth strategy.
 *
 * 1. Spawns a temporary localhost server on a random port
 * 2. Opens the system browser at the server's login URL with
 *    redirect_uri=http://127.0.0.1:<port>/callback
 * 3. The localhost server captures the redirect
 * 4. The code is exchanged for a bearer token
 */
async function loopbackFlow(
  serverUrl: string,
  loginUrl: string,
): Promise<OAuthResult> {
  // Use the Tauri backend to start a localhost server and get the port
  const port: number = await invoke('start_oauth_server');
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Append redirect_uri to the login URL
  let url: URL;
  try {
    url = new URL(loginUrl);
  } catch {
    return { success: false, error: 'Invalid login URL' };
  }
  url.searchParams.set('redirect_uri', redirectUri);

  // Set up a promise that resolves when the callback arrives
  const callbackPromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('OAuth timed out after 5 minutes'));
    }, 5 * 60 * 1000);

    // Listen for the callback from the localhost server
    const interval = setInterval(async () => {
      try {
        const result: string | null = await invoke('poll_oauth_callback', { port });
        if (result) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve(result);
        }
      } catch {
        // Server not ready yet
      }
    }, 500);
  });

  // Open the system browser at the login URL
  await openUrl(url.toString());

  // Wait for the callback
  const callbackUrl = await callbackPromise;

  // Extract the authorization code
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return { success: false, error: 'Invalid callback URL' };
  }
  const code = parsed.searchParams.get('code');
  const error = parsed.searchParams.get('error');

  if (error) {
    return { success: false, error: `OAuth error: ${error}` };
  }

  if (!code) {
    return { success: false, error: 'No authorization code in callback' };
  }

  return await exchangeCode(serverUrl, code);
}

/**
 * Exchange an authorization code for a bearer token via the server.
 *
 * The Chatto server's token exchange endpoint is at /api/connect/...
 * This uses tauri-plugin-http to bypass CORS.
 */
async function exchangeCode(
  serverUrl: string,
  code: string,
): Promise<OAuthResult> {
  try {
    const tokenUrl = new URL('/api/connect/chatto.auth.v1.AuthService/ExchangeToken', serverUrl).toString();
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      return { success: false, error: `Token exchange failed: ${response.status}` };
    }

    const data = await response.json();
    const token = data?.token || data?.accessToken;

    if (!token) {
      return { success: false, error: 'No token in exchange response' };
    }

    return { success: true, token, serverUrl };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Token exchange failed',
    };
  }
}