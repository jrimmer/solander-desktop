import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// Mock global fetch for token exchange
const mockFetch = vi.fn();
beforeAll(() => {
  (globalThis as any).fetch = mockFetch;
});
afterAll(() => {
  delete (globalThis as any).fetch;
});

// Mock Tauri plugin modules
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-deep-link', () => {
  let callback: ((urls: string[]) => void) | null = null;
  return {
    getCurrent: vi.fn().mockResolvedValue(null),
    onOpenUrl: vi.fn().mockImplementation((cb: (urls: string[]) => void) => {
      callback = cb;
      return Promise.resolve(() => { callback = null; });
    }),
    // Expose for tests to trigger the callback
    _triggerCallback: (urls: string[]) => {
      if (callback) callback(urls);
    },
  };
});

describe('startOAuthFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error for invalid login URL', async () => {
    const { startOAuthFlow } = await import('./oauthClient');
    const result = await startOAuthFlow('https://chat.example.com', 'not-a-url', 'deep-link');
    expect(result.success).toBe(false);
  });

  it('returns error when deep-link callback has no code', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const deepLink = await import('@tauri-apps/plugin-deep-link');

    (openUrl as any).mockResolvedValue(undefined);

    const { startOAuthFlow } = await import('./oauthClient');
    const promise = startOAuthFlow('https://chat.example.com', 'https://chat.example.com/oauth/authorize', 'deep-link');

    // Trigger the callback
    await new Promise(r => setTimeout(r, 5));
    (deepLink as any)._triggerCallback(['solander://auth/callback?state=abc']);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result).toEqual({ success: false, error: 'No authorization code in callback' });
  });

  it('returns error when deep-link callback has error param', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const deepLink = await import('@tauri-apps/plugin-deep-link');

    (openUrl as any).mockResolvedValue(undefined);

    const { startOAuthFlow } = await import('./oauthClient');
    const promise = startOAuthFlow('https://chat.example.com', 'https://chat.example.com/oauth/authorize', 'deep-link');

    await new Promise(r => setTimeout(r, 5));
    (deepLink as any)._triggerCallback(['solander://auth/callback?error=access_denied&error_description=User+cancelled']);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result).toEqual({ success: false, error: 'OAuth error: access_denied' });
  });

  it('handles cold-start deep link via getCurrent', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const { getCurrent } = await import('@tauri-apps/plugin-deep-link');

    (openUrl as any).mockResolvedValue(undefined);
    (getCurrent as any).mockResolvedValue('solander://auth/callback?code=abc123&state=xyz');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'bearer-token' }),
    });

    const { startOAuthFlow } = await import('./oauthClient');
    const result = await startOAuthFlow('https://chat.example.com', 'https://chat.example.com/oauth/authorize', 'deep-link');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.token).toBe('bearer-token');
    }
  });

  it('handles warm-start deep link via onOpenUrl', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const deepLink = await import('@tauri-apps/plugin-deep-link');

    (openUrl as any).mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'bearer-token' }),
    });

    const { startOAuthFlow } = await import('./oauthClient');
    const promise = startOAuthFlow('https://chat.example.com', 'https://chat.example.com/oauth/authorize', 'deep-link');

    await new Promise(r => setTimeout(r, 5));
    (deepLink as any)._triggerCallback(['solander://auth/callback?code=abc123&state=xyz']);

    const result = await promise;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.token).toBe('bearer-token');
    }
  });

  it('handles loopback flow', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const { invoke } = await import('@tauri-apps/api/core');

    (openUrl as any).mockResolvedValue(undefined);
    (invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === 'start_oauth_server') return 34567;
      if (cmd === 'poll_oauth_callback') return 'http://127.0.0.1:34567/callback?code=abc123&state=xyz';
      return null;
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'bearer-token' }),
    });

    const { startOAuthFlow } = await import('./oauthClient');
    const result = await startOAuthFlow('https://chat.example.com', 'https://chat.example.com/oauth/authorize', 'loopback');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.token).toBe('bearer-token');
    }
  });

  it('handles token exchange failure', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const deepLink = await import('@tauri-apps/plugin-deep-link');

    (openUrl as any).mockResolvedValue(undefined);
    mockFetch.mockRejectedValue(new Error('Token exchange failed'));

    const { startOAuthFlow } = await import('./oauthClient');
    const promise = startOAuthFlow('https://chat.example.com', 'https://chat.example.com/oauth/authorize', 'deep-link');

    await new Promise(r => setTimeout(r, 5));
    (deepLink as any)._triggerCallback(['solander://auth/callback?code=abc123&state=xyz']);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result).toEqual({ success: false, error: 'Token exchange failed' });
  });
});