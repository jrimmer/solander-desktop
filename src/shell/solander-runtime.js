// Solander desktop runtime — injected into the Chatto SPA by prepare-dist.mjs
// This script runs BEFORE the SPA's own scripts (it is a regular <script>, not
// a module, while SvelteKit's entry is type="module" and therefore deferred).
//
// It does four things:
//   1. Sets up the __SOLANDER__ global so the SPA can detect it's in desktop mode
//   2. Disables service worker registration (not supported under tauri://)
//   3. Overrides fetch() to rewrite tauri://localhost API calls to the
//      configured server URL, using tauri-plugin-http to bypass CORS
//   4. Overrides WebSocket to rewrite tauri://localhost realtime connections
//      to the configured server URL
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
    navigator.serviceWorker.register = () => Promise.reject(
        new Error("Service workers are not supported in Solander desktop"),
      );
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
  function tauriFetch(url, init) {
    var invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (typeof invoke !== "function") {
      return Promise.reject(new Error("Tauri IPC not available"));
    }

    init = init || {};
    var method = init.method || "GET";

    // Convert headers to the array-of-[name, value] format expected by plugin:http
    var headersObj = init.headers || {};
    var headersArr = [];
    if (typeof Headers !== "undefined" && headersObj instanceof Headers) {
      headersObj.forEach((v, k) => {
        headersArr.push([k, v]);
      });
    } else if (Array.isArray(headersObj)) {
      headersArr = headersObj;
    } else {
      for (var k in headersObj) {
        if (Object.hasOwn(headersObj, k)) {
          headersArr.push([k, headersObj[k]]);
        }
      }
    }

    // Convert body to array of bytes (plugin:http expects Array<number> or null)
    var data = null;
    if (init.body != null) {
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
      .then((response) => invoke("plugin:http|fetch_read_body", {
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
        }));
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
})();