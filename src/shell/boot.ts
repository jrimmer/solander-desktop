/**
 * boot.ts — Solander boot-time configuration injection.
 *
 * Reads the configured server URL from the Tauri backend and primes the
 * frontend's origin resolution so it connects to the right Chatto server
 * instead of tauri://localhost.
 *
 * The server URL is injected as a global __SOLANDER__ object before the
 * SPA module evaluates. This is done by prepare-dist.mjs which injects
 * a <script> tag into index.html.
 */

import { invoke } from '@tauri-apps/api/core';

export type SolanderBootConfig = {
  serverUrl: string | null;
  desktop: true;
};

/**
 * Read the configured server URL from the Tauri backend.
 * Returns null if no server is configured yet (first-run).
 */
export async function getServerConfig(): Promise<SolanderBootConfig | null> {
  try {
    const url: string | null = await invoke('get_server_url');
    return url ? { serverUrl: url, desktop: true } : null;
  } catch {
    return null;
  }
}

/**
 * Set the configured server URL in the Tauri backend.
 */
export async function setServerConfig(url: string): Promise<void> {
  await invoke('set_server_url', { url });
}

/**
 * Clear the configured server URL.
 */
export async function clearServerConfig(): Promise<void> {
  await invoke('clear_server_url');
}

/**
 * Read the injected __SOLANDER__ global set by the prepare-dist script.
 * This is the synchronous path used during SPA boot before async IPC is available.
 */
export function readInjectedConfig(): SolanderBootConfig | null {
  if (typeof globalThis === 'undefined') return null;
  const raw = (globalThis as any).__SOLANDER__;
  if (!raw || typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.desktop !== 'boolean' || raw.desktop !== true) return null;
  if (raw.serverUrl !== null && typeof raw.serverUrl !== 'string') return null;
  return raw as SolanderBootConfig;
}