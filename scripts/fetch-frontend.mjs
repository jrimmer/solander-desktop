#!/usr/bin/env node

/**
 * Fetch and build the pinned Chatto frontend.
 *
 * Clones chattocorp/chatto at a pinned tag, runs the upstream pnpm build,
 * and copies the static output to vendor/frontend/build.
 *
 * Usage: node scripts/fetch-frontend.mjs [--tag <tag>]
 *   --tag: upstream tag to pin (default: latest known-good)
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VENDOR_DIR = resolve(ROOT, 'vendor', 'frontend');
const BUILD_CACHE = resolve(ROOT, '.build', 'chatto-upstream');
const DEFAULT_TAG = 'v0.4.8'; // latest known-good upstream release
const UPSTREAM_REPO = 'https://github.com/chattocorp/chatto.git';

const tag = process.argv.includes('--tag')
  ? process.argv[process.argv.indexOf('--tag') + 1]
  : DEFAULT_TAG;

console.log(`[fetch-frontend] Pinning upstream Chatto at ${tag}`);

function runOrExit(cmd, opts) {
  try {
    execSync(cmd, opts);
  } catch (err) {
    console.error(`[fetch-frontend] Command failed: ${cmd}`);
    process.exit(1);
  }
}

// Clone or update the upstream repo
if (!existsSync(BUILD_CACHE)) {
  console.log('[fetch-frontend] Cloning upstream repo...');
  mkdirSync(BUILD_CACHE, { recursive: true });
  runOrExit(`git clone --depth 1 --branch ${tag} ${UPSTREAM_REPO} ${BUILD_CACHE}`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
} else {
  console.log('[fetch-frontend] Updating upstream repo...');
  runOrExit(`git fetch --depth 1 origin tag ${tag}`, { cwd: BUILD_CACHE, stdio: 'inherit' });
  runOrExit(`git checkout ${tag}`, { cwd: BUILD_CACHE, stdio: 'inherit' });
}

// Install upstream dependencies and build the frontend
console.log('[fetch-frontend] Installing upstream dependencies...');
runOrExit('pnpm install --frozen-lockfile', { cwd: BUILD_CACHE, stdio: 'inherit' });

console.log('[fetch-frontend] Building upstream frontend...');
runOrExit('pnpm --filter frontend build', { cwd: BUILD_CACHE, stdio: 'inherit' });

// Copy the build output to vendor/
const buildOutput = resolve(BUILD_CACHE, 'apps', 'frontend', 'build');
if (!existsSync(buildOutput)) {
  console.error(`[fetch-frontend] Build output not found at ${buildOutput}`);
  process.exit(1);
}

if (existsSync(VENDOR_DIR)) {
  rmSync(VENDOR_DIR, { recursive: true });
}
mkdirSync(VENDOR_DIR, { recursive: true });
cpSync(buildOutput, VENDOR_DIR, { recursive: true });

console.log(`[fetch-frontend] Frontend build copied to ${VENDOR_DIR}`);