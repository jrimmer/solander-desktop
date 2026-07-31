#!/usr/bin/env node

/**
 * Prepare the Tauri dist directory.
 *
 * Assembles dist/ with:
 *   dist/index.html          — boot loader (checks for configured server)
 *   dist/server-picker.html  — first-run server URL entry form
 *   dist/app/                — the Chatto SPA build (with __SOLANDER__ injection)
 *
 * The boot loader checks if a server URL is configured via IPC.
 * If configured, it redirects to app/index.html (the SPA).
 * If not, it shows the server picker.
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

// --- Step 3: Copy the SPA build into dist/app/ (if vendor exists) ---
if (hasVendor) {
	const appDir = resolve(DIST, "app");
	mkdirSync(appDir, { recursive: true });
	cpSync(VENDOR, appDir, { recursive: true });

	// --- Step 4: Ensure app/index.html exists ---
	const appIndex = resolve(appDir, "index.html");
	const app200 = resolve(appDir, "200.html");

	if (existsSync(appIndex)) {
		console.log("[prepare-dist] app/index.html already exists.");
	} else if (existsSync(app200)) {
		copyFileSync(app200, appIndex);
		console.log("[prepare-dist] Copied app/200.html -> app/index.html.");
	} else {
		console.error(
			"[prepare-dist] Neither app/index.html nor app/200.html found.",
		);
		console.error(`[prepare-dist] Contents: ${readdirSync(appDir).join(", ")}`);
		process.exit(1);
	}

	// --- Step 5: Inject __SOLANDER__ into app/index.html ---
	let spaHtml = readFileSync(appIndex, "utf-8");
	const injectionScript = `<script>
// Solander desktop runtime — injected by prepare-dist.mjs
globalThis.__SOLANDER__ = {
  get serverUrl() { return localStorage.getItem('solander-server-url'); },
  desktop: true
};
</script>\n`;

	const firstScript = spaHtml.indexOf("<script");
	if (firstScript !== -1) {
		spaHtml =
			spaHtml.slice(0, firstScript) +
			injectionScript +
			spaHtml.slice(firstScript);
		writeFileSync(appIndex, spaHtml, "utf-8");
		console.log("[prepare-dist] Injected __SOLANDER__ into app/index.html.");
	} else {
		console.warn(
			"[prepare-dist] No <script> tag in app/index.html — injection skipped.",
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

// --- Step 7: Create the boot loader index.html ---
const bootLoader = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Solander</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .loader {
      text-align: center;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #2a2a4e;
      border-top-color: #4a90d9;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }
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
    // Use __TAURI_INTERNALS__ directly instead of ES module import
    // to avoid module resolution hangs in the Tauri webview.
    async function boot() {
      try {
        const invoke = window.__TAURI_INTERNALS__?.invoke;
        if (typeof invoke !== 'function') {
          // Not in Tauri or IPC not ready — go straight to SPA
          window.location.replace('app/index.html');
          return;
        }
        const url = await Promise.race([
          invoke('get_server_url'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('IPC timeout')), 3000))
        ]);
        if (url) {
          // Store URL in localStorage so the SPA can read it via __SOLANDER__.serverUrl
          localStorage.setItem('solander-server-url', url);
          window.location.replace('app/index.html');
        } else {
          window.location.replace('server-picker.html');
        }
      } catch {
        // If IPC fails or times out, go straight to the SPA
        window.location.replace('app/index.html');
      }
    }
    boot();
  </script>
</body>
</html>`;

writeFileSync(resolve(DIST, "index.html"), bootLoader, "utf-8");
console.log("[prepare-dist] Created boot loader index.html.");

// --- Step 8: Verify ---
const required = ["index.html", "server-picker.html"];
if (hasVendor) {
	required.push("app/index.html");
}
for (const name of required) {
	if (!existsSync(resolve(DIST, name))) {
		console.warn(`[prepare-dist] Warning: expected asset not found: ${name}`);
	}
}

console.log("[prepare-dist] Dist ready for Tauri.");
