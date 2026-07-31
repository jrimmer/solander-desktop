#!/usr/bin/env node

/**
 * Prepare the Tauri dist directory.
 *
 * Assembles dist/ with:
 *   dist/index.html          — the Chatto SPA (with boot loader + __SOLANDER__ injection)
 *   dist/server-picker.html   — first-run server URL entry form
 *   dist/_app/                — SvelteKit immutable assets
 *
 * The SPA must be at the root of dist/ (not a subdirectory) because
 * SvelteKit uses absolute paths (/_app/...) for its assets.
 *
 * The boot loader logic is injected into the SPA's index.html:
 *   1. Check if a server URL is configured via IPC
 *   2. If yes, set it in localStorage and let the SPA load
 *   3. If no, redirect to server-picker.html
 */

import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const VENDOR = resolve(ROOT, "vendor", "frontend");
const DIST = resolve(ROOT, "dist");
const SHELL = resolve(ROOT, "src", "shell");

// --- Step 1: Check if vendor build exists ---
const hasVendor = existsSync(VENDOR);

if (!hasVendor) {
	console.log(
		"[prepare-dist] No vendor build found — creating shell-only dist (dev mode).",
	);
}

// --- Step 2: Clean and recreate dist/ ---
if (existsSync(DIST)) {
	rmSync(DIST, { recursive: true });
}
mkdirSync(DIST, { recursive: true });

// --- Step 3: Copy the SPA build directly into dist/ (if vendor exists) ---
if (hasVendor) {
	cpSync(VENDOR, DIST, { recursive: true });

	// --- Step 4: Ensure dist/index.html exists ---
	const distIndex = resolve(DIST, "index.html");
	const dist200 = resolve(DIST, "200.html");

	if (existsSync(distIndex)) {
		console.log("[prepare-dist] index.html already exists.");
	} else if (existsSync(dist200)) {
		copyFileSync(dist200, distIndex);
		console.log("[prepare-dist] Copied 200.html -> index.html.");
	} else {
		console.error("[prepare-dist] Neither index.html nor 200.html found.");
		console.error(`[prepare-dist] Contents: ${readdirSync(DIST).join(", ")}`);
		process.exit(1);
	}

	// --- Step 5: Inject __SOLANDER__ + boot loader into index.html ---
	let spaHtml = readFileSync(distIndex, "utf-8");

	// The injection script does two things:
	// 1. Sets up __SOLANDER__ global with the server URL from localStorage
	// 2. Checks if a server URL is configured; if not, redirects to server-picker.html
	// This runs BEFORE the SPA's own scripts, so it can intercept the load.
	const injectionScript = `<script>
// Solander desktop runtime — injected by prepare-dist.mjs
(function() {
  globalThis.__SOLANDER__ = {
    get serverUrl() { return localStorage.getItem('solander-server-url'); },
    desktop: true
  };

  // Boot loader: check if a server URL is configured
  var invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
  if (typeof invoke === 'function') {
    // Synchronously redirect to server-picker if no URL in localStorage
    var storedUrl = localStorage.getItem('solander-server-url');
    if (!storedUrl) {
      // Check IPC for a persisted URL (may have been set by a previous session)
      invoke('get_server_url').then(function(url) {
        if (url) {
          localStorage.setItem('solander-server-url', url);
        } else {
          window.location.replace('server-picker.html');
        }
      }).catch(function() {
        window.location.replace('server-picker.html');
      });
    }
  } else {
    // Not in Tauri — let the SPA load normally
  }
})();
</script>
`;

	const firstScript = spaHtml.indexOf("<script");
	if (firstScript !== -1) {
		spaHtml =
			spaHtml.slice(0, firstScript) +
			injectionScript +
			spaHtml.slice(firstScript);
		writeFileSync(distIndex, spaHtml, "utf-8");
		console.log("[prepare-dist] Injected __SOLANDER__ + boot loader into index.html.");
	} else {
		console.warn(
			"[prepare-dist] No <script> tag in index.html — injection skipped.",
		);
	}
}

// --- Step 6: Copy shell files to dist/ ---
const shellFiles = ["server-picker.html"];
for (const file of shellFiles) {
	const src = resolve(SHELL, file);
	if (existsSync(src)) {
		copyFileSync(src, resolve(DIST, file));
		console.log(`[prepare-dist] Copied ${file} to dist/.`);
	} else {
		console.warn(`[prepare-dist] Shell file not found: ${file}`);
	}
}

// --- Step 7: Create a fallback boot loader if no vendor build ---
if (!hasVendor) {
	const bootLoader = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Solander</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #1a1a2e; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .loader { text-align: center; }
    .spinner { width: 32px; height: 32px; border: 3px solid #2a2a4e; border-top-color: #4a90d9; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #a0a0b0; font-size: 14px; }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <p>Starting Solander...</p>
  </div>
  <script>
    async function boot() {
      try {
        var invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
        if (typeof invoke !== 'function') {
          window.location.replace('server-picker.html');
          return;
        }
        var url = await Promise.race([
          invoke('get_server_url'),
          new Promise(function(_, reject) { setTimeout(function() { reject(new Error('IPC timeout')); }, 3000); })
        ]);
        if (url) {
          localStorage.setItem('solander-server-url', url);
          window.location.replace('index.html');
        } else {
          window.location.replace('server-picker.html');
        }
      } catch (e) {
        window.location.replace('server-picker.html');
      }
    }
    boot();
  </script>
</body>
</html>`;
	writeFileSync(resolve(DIST, "index.html"), bootLoader, "utf-8");
	console.log("[prepare-dist] Created fallback boot loader index.html.");
}

// --- Step 8: Verify ---
const required = ["index.html", "server-picker.html"];
for (const name of required) {
	if (!existsSync(resolve(DIST, name))) {
		console.warn(`[prepare-dist] Warning: expected asset not found: ${name}`);
	}
}

console.log("[prepare-dist] Dist ready for Tauri.");