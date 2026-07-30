#!/usr/bin/env node

/**
 * Prepare the frontend dist for Tauri.
 *
 * Tauri expects index.html as the entry page. The Chatto frontend uses
 * adapter-static with fallback: '200.html', which produces no index.html.
 * This script copies 200.html -> index.html so Tauri has an entry point.
 *
 * Also verifies the build output is complete.
 */

import { copyFileSync, existsSync, readdirSync } from 'node:fs';
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

// Check for index.html
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

// Verify key assets exist
const required = ['index.html', '_app', '.vite'];
for (const name of required) {
  if (!existsSync(resolve(DIST, name))) {
    console.warn(`[prepare-dist] Warning: expected asset not found: ${name}`);
  }
}

console.log('[prepare-dist] Frontend dist ready for Tauri.');