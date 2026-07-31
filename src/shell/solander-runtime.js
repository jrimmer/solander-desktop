// Solander desktop runtime — injected into the Chatto SPA by prepare-dist.mjs
// This script runs BEFORE the SPA's own scripts (it is a regular <script>, not
// a module, while SvelteKit's entry is type="module" and therefore deferred).
//
// It does six things:
//   1. Sets up the __SOLANDER__ global so the SPA can detect it's in desktop mode
//   2. Disables service worker registration (not supported under tauri://)
//   3. Overrides fetch() to rewrite tauri://localhost API calls to the
//      configured server URL, using tauri-plugin-http to bypass CORS
//   4. Overrides WebSocket to rewrite tauri://localhost realtime connections
//      to the configured server URL
//   5. Intercepts external navigation (window.location.href) to open the
//      OAuth authorize endpoint in the system browser with a rewritten
//      redirect_uri (solander://callback)
//   6. Listens for solander://callback deep-links and routes them into the
//      SPA's /servers/callback route so the token exchange can complete
(() => {
	globalThis.__SOLANDER__ = {
		get serverUrl() {
			return localStorage.getItem("solander-server-url");
		},
		desktop: true,
	};

	// --- 1. Disable service worker registration ---
	// Service workers cannot run under the tauri:// custom protocol; the browser
	// throws "must be called with a script URL whose protocol is either HTTP or
	// HTTPS". We replace register() so the SPA's PWA bootstrap fails silently.
	if (navigator.serviceWorker) {
		// Service workers cannot run under the tauri:// custom protocol. Replace
		// register() with a no-op that resolves a fake registration so the SPA's
		// PWA bootstrap code doesn't throw an unhandled rejection.
		navigator.serviceWorker.register = () =>
			Promise.resolve({
				scope: "/",
				update: () => Promise.resolve(),
				unregister: () => Promise.resolve(true),
			});
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
	function isTauriOrigin(url) {
		if (!url) return false;
		return (
			url.indexOf("tauri://localhost") === 0 ||
			url.indexOf("http://tauri.localhost") === 0
		);
	}

	// Check if a URL is a SPA static asset (/_app/...).
	function isSpaAsset(url) {
		return (
			url.indexOf("tauri://localhost/_app/") === 0 ||
			url.indexOf("http://tauri.localhost/_app/") === 0
		);
	}

	// Rewrite a tauri://localhost URL to the configured server URL.
	function rewriteUrl(url) {
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
	function toWsUrl(httpUrl) {
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
	function tauriFetch(input, init) {
		var invoke =
			window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
		if (typeof invoke !== "function") {
			return Promise.reject(new Error("Tauri IPC not available"));
		}

		init = init || {};

		// Build a Request to normalize the input — this handles Request objects,
		// URL objects, and plain strings, and merges init properties.
		// The plugin's own implementation does the same.
		var req;
		try {
			req = new Request(input, init);
		} catch (e) {
			return Promise.reject(e);
		}

		var method = req.method;
		var url = req.url;

		// Extract headers from the Request (includes init.headers merged in)
		var headersArr = [];
		req.headers.forEach((v, k) => {
			headersArr.push([k, v]);
		});

		// Convert body to array of bytes (plugin:http expects Array<number> or null)
		var data = null;
		if (init.body != null) {
			// Use init.body if provided (Request may have a stream that can't be read twice)
			var body = init.body;
			if (typeof body === "string") {
				data = Array.from(new TextEncoder().encode(body));
			} else if (body instanceof ArrayBuffer) {
				data = Array.from(new Uint8Array(body));
			} else if (ArrayBuffer.isView(body)) {
				data = Array.from(new Uint8Array(body.buffer));
			} else if (typeof body === "object") {
				data = Array.from(new TextEncoder().encode(JSON.stringify(body)));
			}
		} else {
			// Try reading from the Request body
			try {
				var buffer = req.arrayBuffer();
				if (buffer && buffer.byteLength > 0) {
					data = Array.from(new Uint8Array(buffer));
				}
			} catch (e) {
				// Body may be a stream that's already consumed
			}
		}

		return invoke("plugin:http|fetch", {
			clientConfig: {
				method: method,
				url: url,
				headers: headersArr,
				data: data,
			},
		})
			.then((rid) => invoke("plugin:http|fetch_send", { rid: rid }))
			.then((response) =>
				invoke("plugin:http|fetch_read_body", {
					rid: response.rid,
				}).then((bodyData) => {
					var bodyUint8 = bodyData
						? new Uint8Array(bodyData)
						: new Uint8Array(0);
					var res = new Response(bodyUint8, {
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
					return res;
				}),
			);
	}

	// --- 3. Override fetch ---
	var origFetch = window.fetch.bind(window);
	window.fetch = (input, init) => {
		var url;
		if (typeof input === "string") {
			url = input;
		} else if (typeof URL !== "undefined" && input instanceof URL) {
			url = input.href;
		} else if (input && input.url) {
			url = input.url;
		} else {
			url = String(input);
		}

		// Rewrite tauri://localhost API calls to the configured server URL,
		// but leave SPA static assets (/_app/...) served by Tauri's protocol.
		if (isTauriOrigin(url) && !isSpaAsset(url)) {
			var rewritten = rewriteUrl(url);
			return tauriFetch(rewritten, init);
		}

		// Route all external https://http:// fetches through tauri-plugin-http
		// to bypass CORS. The webview's built-in fetch is CORS-bound.
		// Pass the original input (may be a Request) so tauriFetch can extract
		// method, headers, and body from it via new Request().
		if (isExternalUrl(url)) {
			return tauriFetch(input, init);
		}

		return origFetch(input, init);
	};

	// --- 4. Override WebSocket ---
	var OrigWebSocket = window.WebSocket;
	function SolanderWebSocket(url, protocols) {
		if (isTauriOrigin(url)) {
			var serverUrl = getServerUrl();
			var wsServerUrl = toWsUrl(serverUrl);
			var path = url;
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
	window.WebSocket = SolanderWebSocket;

	// --- 5. Intercept external navigation (OAuth authorize redirect) ---
	// Chatto's startServerOAuthFlow sets window.location.href to the server's
	// /oauth/authorize URL (external). The Tauri webview blocks external
	// navigation, so we intercept it: rewrite the redirect_uri from
	// tauri://localhost/servers/callback to solander://callback, then open
	// the authorize URL in the system browser via tauri-plugin-opener.
	var DESKTOP_REDIRECT_URI = "solander://callback";
	var SPA_CALLBACK_PATH = "/servers/callback";

	function isExternalUrl(url) {
		if (!url) return false;
		return url.indexOf("http://") === 0 || url.indexOf("https://") === 0;
	}

	function openInSystemBrowser(url) {
		var invoke =
			window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
		if (typeof invoke === "function") {
			invoke("plugin:opener|open_url", { url: url }).catch((e) => {
				console.error("[solander] failed to open URL in browser:", e);
			});
		}
	}

	// Rewrite the redirect_uri parameter in an OAuth authorize URL.
	function rewriteAuthorizeUrl(url) {
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
	// We use a property descriptor on window.location to catch assignments.
	// Note: this is a best-effort interception. Some code paths may use
	// window.location.replace() or assign() instead.
	var origLocationDescriptor = Object.getOwnPropertyDescriptor(
		window.Location.prototype,
		"href",
	);
	if (origLocationDescriptor && origLocationDescriptor.set) {
		Object.defineProperty(window.Location.prototype, "href", {
			get: function () {
				return origLocationDescriptor.get.call(this);
			},
			set: function (value) {
				if (isExternalUrl(value)) {
					var rewritten = rewriteAuthorizeUrl(value);
					openInSystemBrowser(rewritten);
					return;
				}
				origLocationDescriptor.set.call(this, value);
			},
		});
	}

	// Also intercept location.assign() and location.replace()
	var origAssign = window.Location.prototype.assign;
	window.Location.prototype.assign = function (url) {
		if (isExternalUrl(url)) {
			openInSystemBrowser(rewriteAuthorizeUrl(url));
			return;
		}
		return origAssign.call(this, url);
	};
	var origReplace = window.Location.prototype.replace;
	window.Location.prototype.replace = function (url) {
		if (isExternalUrl(url)) {
			openInSystemBrowser(rewriteAuthorizeUrl(url));
			return;
		}
		return origReplace.call(this, url);
	};

	// Also intercept window.open() (used by some OAuth flows)
	var origWindowOpen = window.open;
	window.open = function (url) {
		if (isExternalUrl(url)) {
			openInSystemBrowser(rewriteAuthorizeUrl(url));
			return null;
		}
		return origWindowOpen.apply(this, arguments);
	};

	// --- 6. Listen for solander://callback deep-links ---
	// After the user signs in on the server, the system browser redirects to
	// solander://callback?code=...&state=... . The OS hands this to Solander,
	// and tauri-plugin-deep-link emits a 'deep-link://new-url' event. We
	// route the callback parameters into the SPA's /servers/callback route.
	function handleDeepLinkUrl(deepLinkUrl) {
		console.log("[solander] deep-link received:", deepLinkUrl);
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
					console.log("[solander] routing to SPA callback:", spaCallback);
					window.location.replace(spaCallback);
				}
			}
		} catch (e) {
			console.error("[solander] failed to handle deep-link:", e);
		}
	}

	var invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
	if (typeof invoke === "function") {
		// Poll for pending OAuth callbacks. The Rust side stores
		// solander://callback URLs via the deep-link event listener in lib.rs;
		// the webview polls take_pending_callback() to retrieve them. This avoids
		// relying on @tauri-apps/api/event module resolution in the webview.
		function pollPendingCallback() {
			invoke("take_pending_callback")
				.then((url) => {
					if (url) {
						handleDeepLinkUrl(url);
					}
				})
				.catch(() => {});
		}

		// Check immediately (cold-start case) and then poll every 1s.
		pollPendingCallback();
		setInterval(pollPendingCallback, 1000);
	}
})();
