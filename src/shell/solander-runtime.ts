// Solander desktop runtime — injected into the Chatto SPA by prepare-dist.mjs
// This script runs BEFORE the SPA's own scripts (it is a regular <script>, not
// a module, while SvelteKit's entry is type="module" and therefore deferred).
//
// Build: esbuild bundles this TS source into solander-runtime.js (IIFE format)
// which prepare-dist.mjs inlines into the SPA's index.html.
//
// It does eight things:
//   1. Sets up the __SOLANDER__ global so the SPA can detect it's in desktop mode
//   2. Disables service worker registration (not supported under tauri://)
//   3. Overrides fetch() to rewrite tauri://localhost + relative API calls to
//      the configured server URL, using tauri-plugin-http to bypass CORS
//   4. Overrides WebSocket to rewrite tauri://localhost realtime connections
//   5. Intercepts external navigation (window.location.href) to open the
//      OAuth authorize endpoint in the system browser with a rewritten
//      redirect_uri (solander://callback)
//   6. Listens for solander://callback deep-links (event-driven) and routes
//      them into the SPA's /servers/callback route
//   7. Bridges navigator.setAppBadge/clearAppBadge (Badging API) to Tauri's
//      set_badge_count so the app badge works without a service worker
//   8. Guards against runtime failure — shows a clear error if the runtime
//      is missing when the SPA tries to use it

// --- Type declarations for Tauri webview internals ---
// These are injected by Tauri before our script runs; they have no types.
interface TauriInternals {
	invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
	transformCallback: (
		callback: (response: unknown) => void,
		once?: boolean,
	) => number;
}

interface SolanderGlobal {
	serverUrl: string | null;
	desktop: boolean;
	runtimeReady: boolean;
	runtimeError: string | null;
	_deepLinkEventId?: number;
	_pollFallback?: ReturnType<typeof setInterval>;
}

declare global {
	interface Window {
		__TAURI_INTERNALS__?: TauriInternals;
		__TAURI__?: unknown;
	}
	var __SOLANDER__: SolanderGlobal;
}

// Service worker registration stub returned by the no-op override
// (kept for documentation; the override casts via unknown)

// Response shape returned by plugin:http|fetch_send
interface TauriHttpResponse {
	status: number;
	statusText: string;
	url: string;
	headers: Array<[string, string]> | Record<string, string>;
	rid: number;
}

(() => {
	const TAG = "[solander]";

	// --- 0. Error guard ---
	// If the runtime fails partway through, the SPA may load with a broken
	// fetch override and show a black screen. We expose a sentinel so the
	// boot loader / SPA can detect a healthy runtime.
	globalThis.__SOLANDER__ = {
		get serverUrl() {
			return localStorage.getItem("solander-server-url");
		},
		desktop: true,
		runtimeReady: false,
		runtimeError: null,
	};

	function tauriInvoke(
		cmd: string,
		args?: Record<string, unknown>,
	): Promise<unknown> {
		var internals = window.__TAURI_INTERNALS__;
		if (!internals || typeof internals.invoke !== "function") {
			return Promise.reject(new Error("Tauri IPC not available"));
		}
		return internals.invoke(cmd, args);
	}

	// --- 1. Disable service worker registration ---
	// Service workers cannot run under the tauri:// custom protocol; the browser
	// throws "must be called with a script URL whose protocol is either HTTP or
	// HTTPS". We replace register() so the SPA's PWA bootstrap fails silently.
	if (navigator.serviceWorker) {
		navigator.serviceWorker.register = (() =>
			Promise.resolve({
				scope: "/",
				update: () => Promise.resolve(),
				unregister: () => Promise.resolve(true),
			})) as unknown as typeof navigator.serviceWorker.register;
	}

	// --- Helpers ---

	// Get the server URL from localStorage, without a trailing slash.
	function getServerUrl() {
		var url = localStorage.getItem("solander-server-url") || "";
		while (url.length > 0 && url.charAt(url.length - 1) === "/") {
			url = url.slice(0, -1);
		}
		return url;
	}

	// Check if a URL string is a tauri://localhost or http://tauri.localhost URL.
	function isTauriOrigin(url: string): boolean {
		if (!url) return false;
		return (
			url.indexOf("tauri://localhost") === 0 ||
			url.indexOf("http://tauri.localhost") === 0
		);
	}

	// Check if a URL is a SPA static asset (/_app/...).
	// Matches both tauri://localhost/_app/... and relative /_app/...
	function isSpaAsset(url: string): boolean {
		return (
			url.indexOf("tauri://localhost/_app/") === 0 ||
			url.indexOf("http://tauri.localhost/_app/") === 0 ||
			url.indexOf("/_app/") === 0 ||
			url === "/_app/version.json" ||
			url.indexOf("/_app/") === 0
		);
	}

	// Check if a relative path is a SPA asset that should be served by Tauri,
	// not rewritten to the server URL.
	function isRelativeSpaAsset(url: string): boolean {
		return (
			url.indexOf("/_app/") === 0 ||
			url.indexOf("/@vite/") === 0 ||
			url.indexOf("/node_modules/") === 0
		);
	}

	// Check if a URL string is a relative path (e.g. /auth/login, /api/connect/...).
	// These must be rewritten to the configured server URL because they
	// otherwise resolve against tauri://localhost (the asset protocol).
	function isRelativePath(url: string): boolean {
		return (
			typeof url === "string" &&
			url.length > 0 &&
			url.charAt(0) === "/" &&
			url.charAt(1) !== "/" // exclude protocol-relative URLs (//host/...)
		);
	}

	// Check if a URL is external (http:// or https://).
	function isExternalUrl(url: string): boolean {
		if (!url) return false;
		return url.indexOf("http://") === 0 || url.indexOf("https://") === 0;
	}

	// Rewrite a tauri://localhost URL to the configured server URL.
	function rewriteUrl(url: string): string {
		var serverUrl = getServerUrl();
		if (!serverUrl) return url;
		var path = url;
		if (path.indexOf("tauri://localhost") === 0) {
			path = path.substring("tauri://localhost".length);
		} else if (path.indexOf("http://tauri.localhost") === 0) {
			path = path.substring("http://tauri.localhost".length);
		}
		return serverUrl + path;
	}

	// Convert an http(s):// server URL to ws(s):// for WebSocket connections.
	function toWsUrl(httpUrl: string): string {
		if (httpUrl.indexOf("https://") === 0) {
			return "wss://" + httpUrl.substring(8);
		}
		if (httpUrl.indexOf("http://") === 0) {
			return "ws://" + httpUrl.substring(7);
		}
		return httpUrl;
	}

	// --- 2. tauri-plugin-http fetch (bypasses CORS by running in Rust) ---
	// Mirrors @tauri-apps/plugin-http's fetch() but calls the IPC directly
	// so we don't depend on ES module resolution in the webview.
	function tauriFetch(input: RequestInfo | URL, init?: RequestInit) {
		return asyncTauriFetch(input, init);
	}

	async function asyncTauriFetch(
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> {
		init = init || {};

		// Build a Request to normalize the input — this handles Request objects,
		// URL objects, and plain strings, and merges init properties.
		var req;
		try {
			req = new Request(input, init);
		} catch (e) {
			console.error(TAG, "Request construction failed:", e);
			throw e;
		}

		var method = req.method;
		var url = req.url;

		// Extract headers from the Request (includes init.headers merged in)
		var headersArr: Array<[string, string]> = [];
		req.headers.forEach((v, k) => {
			headersArr.push([k, v]);
		});

		// Convert body to array of bytes (plugin:http expects Array<number> or null)
		// Must await req.arrayBuffer() — it returns a Promise.
		var data = null;
		if (init.body != null) {
			var reqBody = init.body;
			if (typeof reqBody === "string") {
				data = Array.from(new TextEncoder().encode(reqBody));
			} else if (reqBody instanceof ArrayBuffer) {
				data = Array.from(new Uint8Array(reqBody));
			} else if (ArrayBuffer.isView(reqBody)) {
				data = Array.from(new Uint8Array(reqBody.buffer));
			} else if (typeof reqBody === "object") {
				data = Array.from(new TextEncoder().encode(JSON.stringify(reqBody)));
			}
		} else {
			// Read body from the Request (async)
			try {
				var buffer = await req.arrayBuffer();
				if (buffer && buffer.byteLength > 0) {
					data = Array.from(new Uint8Array(buffer));
				}
			} catch (e) {
				// Body may be a stream that's already consumed — that's OK
			}
		}

		console.log(
			TAG,
			"fetch →",
			method,
			url,
			"headers:",
			headersArr.length,
			"body:",
			data ? data.length + " bytes" : "null",
		);

		var rid = await tauriInvoke("plugin:http|fetch", {
			clientConfig: {
				method: method,
				url: url,
				headers: headersArr,
				data: data,
			},
		});
		var response = (await tauriInvoke("plugin:http|fetch_send", {
			rid: rid,
		})) as TauriHttpResponse;

		// Build the Response with a streaming body that respects the
		// plugin:http streaming protocol: each fetch_read_body chunk's LAST
		// byte is a close signal (1 = done, 0 = more data). Null-body
		// statuses (101, 103, 204, 205, 304) have no body at all.
		var responseRid = response.rid;
		var nullBodyStatus = [101, 103, 204, 205, 304].includes(response.status);
		const responseBody: BodyInit | null = nullBodyStatus
			? null
			: new ReadableStream({
					pull: async (controller) => {
						var chunk: unknown;
						try {
							chunk = await tauriInvoke("plugin:http|fetch_read_body", {
								rid: responseRid,
							});
						} catch (e) {
							controller.error(e);
							return;
						}
						var dataUint8 = new Uint8Array(chunk as unknown as ArrayBuffer);
						var lastByte = dataUint8[dataUint8.length - 1];
						var actualData = dataUint8.slice(0, dataUint8.length - 1);
						if (lastByte === 1) {
							controller.close();
							return;
						}
						controller.enqueue(actualData);
					},
				});

		var res = new Response(responseBody, {
			status: response.status,
			statusText: response.statusText,
		});
		// Response.url and Response.headers are read-only; define them
		Object.defineProperty(res, "url", {
			value: response.url,
			writable: false,
		});
		Object.defineProperty(res, "headers", {
			value: new Headers(response.headers),
			writable: false,
		});
		// Patch clone() so cloning preserves the overridden props
		var originalClone = res.clone.bind(res);
		Object.defineProperty(res, "clone", {
			value: () => {
				var cloned = originalClone();
				Object.defineProperty(cloned, "url", {
					value: response.url,
					writable: false,
				});
				Object.defineProperty(cloned, "headers", {
					value: new Headers(response.headers),
					writable: false,
				});
				return cloned;
			},
			writable: false,
		});
		console.log(
			TAG,
			"fetch ←",
			response.status,
			url,
			"headers:",
			JSON.stringify(response.headers),
		);
		return res;
	}

	// --- 3. Override fetch ---
	var origFetch = window.fetch.bind(window);
	window.fetch = (input, init) => {
		var url;
		if (typeof input === "string") {
			url = input;
		} else if (typeof URL !== "undefined" && input instanceof URL) {
			url = input.href;
		} else if (input && "url" in input) {
			url = (input as Request).url;
		} else {
			url = String(input);
		}

		// Rewrite tauri://localhost API calls to the configured server URL,
		// but leave SPA static assets (/_app/...) served by Tauri's protocol.
		if (isTauriOrigin(url) && !isSpaAsset(url)) {
			var rewritten = rewriteUrl(url);
			return tauriFetch(rewritten, init);
		}

		// Rewrite relative paths (e.g. /auth/login, /api/connect/...) to the
		// configured server URL. Under tauri://localhost these would resolve
		// against the asset protocol and hit no Chatto server.
		// BUT: SPA static assets (/_app/...) must be served by Tauri locally.
		if (isRelativePath(url) && !isRelativeSpaAsset(url)) {
			var fullUrl = getServerUrl() + url;
			return tauriFetch(fullUrl, init);
		}

		// Route all external https://http:// fetches through tauri-plugin-http
		// to bypass CORS. The webview's built-in fetch is CORS-bound.
		if (isExternalUrl(url)) {
			return tauriFetch(input, init);
		}

		return origFetch(input, init);
	};

	// --- 4. Override WebSocket ---
	var OrigWebSocket = window.WebSocket;
	function SolanderWebSocket(url: string | URL, protocols?: string | string[]) {
		const urlStr = typeof url === "string" ? url : url.toString();
		if (isTauriOrigin(urlStr)) {
			var serverUrl = getServerUrl();
			var wsServerUrl = toWsUrl(serverUrl);
			var path = urlStr;
			if (path.indexOf("tauri://localhost") === 0) {
				path = path.substring("tauri://localhost".length);
			} else if (path.indexOf("http://tauri.localhost") === 0) {
				path = path.substring("http://tauri.localhost".length);
			}
			return new OrigWebSocket(wsServerUrl + path, protocols);
		}
		return new OrigWebSocket(url, protocols);
	}
	SolanderWebSocket.prototype = OrigWebSocket.prototype;
	SolanderWebSocket.CONNECTING = OrigWebSocket.CONNECTING;
	SolanderWebSocket.OPEN = OrigWebSocket.OPEN;
	SolanderWebSocket.CLOSING = OrigWebSocket.CLOSING;
	SolanderWebSocket.CLOSED = OrigWebSocket.CLOSED;
	window.WebSocket = SolanderWebSocket as unknown as typeof WebSocket;

	// --- 5. Intercept external navigation (OAuth authorize redirect) ---
	// Chatto's startServerOAuthFlow sets window.location.href to the server's
	// /oauth/authorize URL (external). The Tauri webview blocks external
	// navigation, so we intercept it: rewrite the redirect_uri from
	// tauri://localhost/servers/callback to solander://callback, then open
	// the authorize URL in the system browser via tauri-plugin-opener.
	var DESKTOP_REDIRECT_URI = "solander://callback";
	var SPA_CALLBACK_PATH = "/servers/callback";

	function openInSystemBrowser(url: string) {
		tauriInvoke("plugin:opener|open_url", { url: url }).catch((e) => {
			console.error(TAG, "failed to open URL in browser:", e);
		});
	}

	// Rewrite the redirect_uri parameter in an OAuth authorize URL.
	function rewriteAuthorizeUrl(url: string): string {
		try {
			var parsed = new URL(url);
			if (parsed.searchParams.has("redirect_uri")) {
				parsed.searchParams.set("redirect_uri", DESKTOP_REDIRECT_URI);
				return parsed.toString();
			}
		} catch (e) {
			// Not a parseable URL — return as-is
		}
		return url;
	}

	// Intercept window.location.href assignments to external URLs.
	var origLocationDescriptor = Object.getOwnPropertyDescriptor(
		window.Location.prototype,
		"href",
	);
	if (origLocationDescriptor && origLocationDescriptor.set) {
		const origGet = origLocationDescriptor.get?.bind(window.Location.prototype);
		const origSet = origLocationDescriptor.set?.bind(window.Location.prototype);
		Object.defineProperty(window.Location.prototype, "href", {
			get: function () {
				return origGet?.call(this);
			},
			set: function (value: string) {
				if (isExternalUrl(value)) {
					openInSystemBrowser(rewriteAuthorizeUrl(value));
					return;
				}
				origSet?.call(this, value);
			},
		});
	}

	// Also intercept location.assign() and location.replace()
	var origAssign = window.Location.prototype.assign;
	window.Location.prototype.assign = function (url: string | URL) {
		const urlStr = typeof url === "string" ? url : url.toString();
		if (isExternalUrl(urlStr)) {
			openInSystemBrowser(rewriteAuthorizeUrl(urlStr));
			return;
		}
		return origAssign.call(this, url);
	};
	var origReplace = window.Location.prototype.replace;
	window.Location.prototype.replace = function (url: string | URL) {
		const urlStr = typeof url === "string" ? url : url.toString();
		if (isExternalUrl(urlStr)) {
			openInSystemBrowser(rewriteAuthorizeUrl(urlStr));
			return;
		}
		return origReplace.call(this, url);
	};

	// Also intercept window.open() (used by some OAuth flows)
	var origWindowOpen = window.open;
	window.open = function (url?: string | URL) {
		const urlStr = typeof url === "string" ? url : (url?.toString() ?? "");
		if (isExternalUrl(urlStr)) {
			openInSystemBrowser(rewriteAuthorizeUrl(urlStr));
			return null;
		}
		return origWindowOpen.apply(this, arguments as unknown as [string]);
	};

	// --- 6. Listen for solander://callback deep-links (event-driven) ---
	// After the user signs in on the server, the system browser redirects to
	// solander://callback?code=...&state=... . The OS hands this to Solander,
	// and tauri-plugin-deep-link emits a 'deep-link://new-url' event. We
	// route the callback parameters into the SPA's /servers/callback route.
	function handleDeepLinkUrl(deepLinkUrl: string) {
		console.log(TAG, "deep-link received:", deepLinkUrl);
		try {
			var parsed = new URL(deepLinkUrl);
			// Accept solander://callback?code=...&state=...
			if (parsed.protocol === "solander:" && parsed.hostname === "callback") {
				var code = parsed.searchParams.get("code");
				var state = parsed.searchParams.get("state");
				var error = parsed.searchParams.get("error");
				if (code || error) {
					var params = new URLSearchParams();
					if (code) params.set("code", code);
					if (state) params.set("state", state);
					if (error) {
						params.set("error", error);
						var desc = parsed.searchParams.get("error_description");
						if (desc) params.set("error_description", desc);
					}
					var spaCallback = SPA_CALLBACK_PATH + "?" + params.toString();
					console.log(TAG, "routing to SPA callback:", spaCallback);
					window.location.replace(spaCallback);
				}
			}
		} catch (e) {
			console.error(TAG, "failed to handle deep-link:", e);
		}
	}

	// Fallback polling for deep-link callbacks — used when the event
	// listener can't be registered (e.g. transformCallback unavailable).
	function startFallbackPolling(intervalMs: number) {
		var pollFallback = setInterval(() => {
			tauriInvoke("take_pending_callback")
				.then((url) => {
					if (url) handleDeepLinkUrl(url as string);
				})
				.catch(() => {});
		}, intervalMs);
		globalThis.__SOLANDER__._pollFallback = pollFallback;
	}

	// Event-driven deep-link handling via Tauri's event system.
	// We listen for the 'deep-link://new-url' event directly through
	// __TAURI_INTERNALS__ instead of polling take_pending_callback().
	// This eliminates the 1s setInterval and is responsive immediately.
	function setupDeepLinkListener() {
		// Handle cold-start: check for a pending callback that arrived before
		// the webview was ready (the Rust side queues it).
		tauriInvoke("take_pending_callback")
			.then((url) => {
				if (url) handleDeepLinkUrl(url as string);
			})
			.catch(() => {});

		// Listen for live deep-link events via the event system.
		// We use the raw event listen API with transformCallback to register
		// a proper callback handler (ES module imports hang in the webview).
		var internals = window.__TAURI_INTERNALS__;
		if (
			!internals ||
			typeof internals.transformCallback !== "function" ||
			typeof internals.invoke !== "function"
		) {
			console.warn(
				TAG,
				"Tauri internals not available for event listen, falling back to polling",
			);
			startFallbackPolling(1000);
			return;
		}
		var handlerId = internals.transformCallback((event: unknown) => {
			try {
				var payload = (event as { payload?: { url?: string } })
					?.payload;
				var url = payload?.url;
				if (url) handleDeepLinkUrl(url);
			} catch (e) {
				console.error(TAG, "deep-link event handler error:", e);
			}
		});
		tauriInvoke("plugin:event|listen", {
			event: "deep-link://new-url",
			target: { kind: "Any" },
			handler: handlerId,
		})
			.then((eventId) => {
				// Store the event id so we can unlisten if needed
				globalThis.__SOLANDER__._deepLinkEventId =
					eventId as number;
				// The event arrives via __TAURI_INTERNALS__ callbacks;
				// we also poll take_pending_callback as a fallback for events
				// that arrive while the listener is being set up.
				var pollFallback = setInterval(() => {
					tauriInvoke("take_pending_callback")
						.then((url) => {
							if (url) handleDeepLinkUrl(url as string);
						})
						.catch(() => {});
				}, 2000);
				// Stop the fallback after 30s — by then the event listener
				// should be working (or we have a bigger problem).
				setTimeout(() => clearInterval(pollFallback), 30000);
			})
			.catch((e) => {
				console.warn(
					TAG,
					"failed to register deep-link event listener, falling back to polling:",
					e,
				);
				startFallbackPolling(1000);
			});
	}

	// --- 7. Bridge Badging API → Tauri set_badge_count ---
	// Chatto's NotificationSync component calls navigator.setAppBadge(count)
	// and navigator.clearAppBadge() to update the dock/taskbar badge.
	// Under tauri://, the Badging API is not available, but tauri's window
	// plugin provides set_badge_count (macOS/Linux) and set_overlay (Windows).
	// We override the Badging API so Chatto's own badge logic drives the
	// native badge directly — no need to hook into the SPA's unread state.
	function setupBadgeBridge() {
		// Define navigator.setAppBadge and navigator.clearAppBadge so
		// Chatto's isSupported() check ('setAppBadge' in navigator) passes,
		// and its updateBadge() calls route through Tauri.
		try {
			Object.defineProperty(navigator, "setAppBadge", {
				value: (count?: number) =>
					tauriInvoke("plugin:window|set_badge_count", {
						label: "main",
						count: count,
					}).catch((e) => {
						console.warn(TAG, "setAppBadge failed:", e);
					}),
				writable: false,
				configurable: true,
			});
			Object.defineProperty(navigator, "clearAppBadge", {
				value: () =>
					tauriInvoke("plugin:window|set_badge_count", {
						label: "main",
						count: null,
					}).catch((e) => {
						console.warn(TAG, "clearAppBadge failed:", e);
					}),
				writable: false,
				configurable: true,
			});
			console.log(TAG, "badge bridge installed (setAppBadge/clearAppBadge)");
		} catch (e) {
			console.warn(TAG, "failed to install badge bridge:", e);
		}
	}

	// --- 8. Mark runtime as ready ---
	globalThis.__SOLANDER__.runtimeReady = true;

	// --- Initialize subsystems that need Tauri IPC ---
	if (
		window.__TAURI_INTERNALS__ &&
		typeof window.__TAURI_INTERNALS__.invoke === "function"
	) {
		setupDeepLinkListener();
		setupBadgeBridge();
	} else {
		console.warn(
			TAG,
			"Tauri IPC not available — deep-link and badge bridges disabled",
		);
		globalThis.__SOLANDER__.runtimeError = "Tauri IPC not available";
	}
})();

export {};
