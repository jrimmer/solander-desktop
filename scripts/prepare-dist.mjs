#!/usr/bin/env node

/**
 * Prepare the frontend dist for Tauri.
 *
 * 1. Tauri expects index.html as the entry page. The Chatto frontend uses
 *    adapter-static with fallback: '200.html', which produces no index.html.
 *    This script copies 200.html -> index.html so Tauri has an entry point.
 *
 * 2. Injects a <script> tag into index.html that sets __SOLANDER__ before
 *    the SPA module evaluates. This is the server-URL injection seam that
 *    lets the frontend discover its API origin from the configured server
 *    instead of tauri://localhost.
 */

import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'vendor', 'frontend');

if (!existsSync(DIST)) {
  console.error(`[prepare-dist] Build output not found at ${DIST}`);
  console.error('[prepare-dist] Run `pnpm fetch-frontend` first.');
  process.exit(1);
}

// Step 1: Ensure index.html exists
const hasIndex = existsSync(resolve(DIST, 'index.html'));
const has200 = existsSync(resolve(DIST, '200.html'));

if (hasIndex) {
  console.log('[prepare-dist] index.html already exists — no rename needed.');
} else if (has200) {
  copyFileSync(resolve(DIST, '200.html'), resolve(DIST, 'index.html'));
  console.log('[prepare-dist] Copied 200.html -> index.html for Tauri entry.');
} else {
  console.error('[prepare-dist] Neither index.html nor 200.html found in build output.');
  console.error(`[prepare-dist] Contents: ${readdirSync(DIST).join(', ')}`);
  process.exit(1);
}

// Step 2: Inject __SOLANDER__ global into index.html
const indexPath = resolve(DIST, 'index.html');
let html = readFileSync(indexPath, 'utf-8');

const injectionScript = `<script>
globalThis.__SOLANDER__ = {
  serverUrl: null,
  desktop: true
};
</script>\n`;

// Insert before the first <script> tag (the SPA entry module)
const firstScriptIndex = html.indexOf('<script');
if (firstScriptIndex !== -1) {
  html = html.slice(0, firstScriptIndex) + injectionScript + html.slice(firstScriptIndex);
  writeFileSync(indexPath, html, 'utf-8');
  console.log('[prepare-dist] Injected __SOLANDER__ global into index.html.');
} else {
  console.warn('[prepare-dist] No <script> tag found in index.html — injection skipped.');
}

// Verify key assets exist
const required = ['index.html', '_app', '.vite'];
for (const name of required) {
  if (!existsSync(resolve(DIST, name))) {
    console.warn(`[prepare-dist] Warning: expected asset not found: ${name}`);
  }
}

console.log('[prepare-dist] Frontend dist ready for Tauri.');