#!/usr/bin/env node

/**
 * Build the Solander runtime from TypeScript → IIFE JavaScript.
 *
 * The runtime must be a regular <script> (not an ES module) because it runs
 * BEFORE the SPA's own deferred module scripts. esbuild bundles the TS source
 * into a single IIFE file that prepare-dist.mjs inlines into index.html.
 */

import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ENTRY = resolve(ROOT, "src", "shell", "solander-runtime.ts");
const OUT = resolve(ROOT, "src", "shell", "solander-runtime.js");

await build({
	entryPoints: [ENTRY],
	bundle: true,
	format: "iife",
	target: "es2022",
	platform: "browser",
	outfile: OUT,
	// The runtime uses window globals directly; no external deps to bundle.
	external: [],
	// Minify for smaller injection into index.html
	minify: true,
	// Keep the source map out of the inlined output
	sourcemap: false,
	// Tree-shaking for unused exports
	treeShaking: true,
	legalComments: "none",
});

console.log("[build-runtime] Built solander-runtime.js (IIFE) from TypeScript");
