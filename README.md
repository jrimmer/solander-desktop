# Solander

A desktop client for [Chatto](https://github.com/chattocorp/chatto) — the open-source chat platform at [chatto.run](https://chatto.run).

Solander wraps the Chatto web frontend in a native desktop shell using [Tauri](https://tauri.app), giving you a standalone app with native OS notifications, dock/taskbar badges, and system-browser-based OAuth sign-in — no browser tab required.

> ⚠️ **Text chat only.** Voice, video, and screen share are not yet supported. See [Voice & Video](#voice--video) below. Contributions welcome via PR.

---

## Download

Pre-built binaries are available on the [GitHub Releases page](https://github.com/jrimmer/solander-desktop/releases).

### macOS

1. Download `Solander_*_universal.dmg`
2. Open the `.dmg` and drag **Solander** to **Applications**
3. On first launch, macOS will show a Gatekeeper warning (the app is unsigned). Right-click → **Open**, or run:

   ```bash
   xattr -cr /Applications/Solander.app
   open /Applications/Solander.app
   ```

### Windows

1. Download `Solander_*_x64-setup.exe`
2. Run the installer
3. If SmartScreen appears, click **More info** → **Run anyway**

### Linux

1. Download `Solander_*_amd64.AppImage` (or the `.deb` package)
2. For AppImage:

   ```bash
   chmod +x Solander_*_amd64.AppImage
   ./Solander_*_amd64.AppImage
   ```

3. For `.deb`:

   ```bash
   sudo dpkg -i Solander_*_amd64.deb
   ```

---

## How It Works

Solander consumes the Chatto frontend as a pinned upstream build — it does not fork or modify the frontend source. At build time, the [`fetch-frontend`](scripts/fetch-frontend.mjs) script clones a pinned Chatto release tag and builds the SPA. A [runtime layer](src/shell/solander-runtime.ts) is then injected into the SPA to bridge it into the Tauri desktop environment.

The runtime handles:

- **Fetch proxying** — Rewrites `tauri://localhost` API calls and relative paths to the configured Chatto server URL, routing them through `tauri-plugin-http` to bypass CORS
- **WebSocket rewriting** — Rewrites realtime WebSocket connections to the server URL
- **OAuth** — Intercepts the Chatto server's OAuth redirect, opens it in the system browser, and captures the callback via a `solander://` deep link
- **Notifications** — `tauri-plugin-notification` injects `window.Notification`, so the SPA's existing notification calls fire native OS notifications
- **App badge** — Bridges `navigator.setAppBadge()` / `clearAppBadge()` (Badging API) to Tauri's `set_badge_count`, so the dock/taskbar badge reflects unread messages
- **Service worker** — The SPA's service worker registration is stubbed (service workers don't run under the `tauri://` scheme); the runtime provides no-op shims so the SPA's PWA bootstrap doesn't break

### First-Run Flow

1. User enters their Chatto server URL (e.g. `https://chat.chatto.run`)
2. Solander persists it and redirects to the SPA
3. The SPA connects to the server and shows the sign-in screen
4. OAuth sign-in opens in the system browser; the callback returns via `solander://` deep link

---

## Technical Platform

| Component | Technology |
|-----------|-----------|
| Desktop shell | [Tauri](https://tauri.app) v2 (Rust + WebKit/WebView2) |
| Upstream frontend | [SvelteKit](https://kit.svelte.dev) + [Vite](https://vite.dev) (built from Chatto's pinned release) |
| API transport | [ConnectRPC](https://connectrpc.com) over HTTP, bridged via `tauri-plugin-http` |
| Realtime | Native WebSocket (protobuf frames), URL-rewritten to the server |
| Notifications | `tauri-plugin-notification` |
| Deep links | `tauri-plugin-deep-link` (`solander://` scheme) |
| System browser | `tauri-plugin-opener` |
| Single instance | `tauri-plugin-single-instance` |
| Build tooling | [pnpm](https://pnpm.io), [esbuild](https://esbuild.github.io) (runtime bundling), [Vitest](https://vitest.dev) (tests) |

### Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| macOS (Apple Silicon + Intel) | ✅ Supported | Universal binary |
| Windows | ✅ Supported | x64 |
| Linux | ✅ Text chat only | WebKitGTK has no WebRTC — voice/video/screenshare unavailable |

---

## Voice & Video

Solander currently supports **text chat only**. The Chatto frontend includes full [LiveKit](https://livekit.io) voice/video/screenshare, but Tauri's webview has WebRTC limitations:

- **macOS** — Technically possible but requires permission/entitlement work (not yet implemented)
- **Windows** — Same as macOS (not yet implemented)
- **Linux** — Not possible: WebKitGTK has no WebRTC support under Tauri/wry

A media abstraction seam ([`src/shell/media.ts`](src/shell/media.ts)) is in place for future implementation. If you'd like to work on voice/video support, PRs are welcome.

---

## Build & Run Locally

### Prerequisites

- [Node.js](https://nodejs.org) 22+
- [pnpm](https://pnpm.io) 10+
- [Rust](https://rustup.rs) (stable toolchain)
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils`
  - **Windows**: Microsoft C++ Build Tools (WebView2 is preinstalled on Windows 10/11)

### Development

```bash
git clone https://github.com/jrimmer/solander-desktop.git
cd solander-desktop
pnpm install
pnpm dev
```

This builds the runtime and serves the SPA via Tauri's dev mode. On first run you'll see the server picker — enter a Chatto server URL to proceed.

> **Note:** Dev mode does not fetch the upstream frontend. To test against a real upstream build, run `pnpm fetch-frontend` first, then `pnpm dev`.

### Release Build

```bash
pnpm build
```

This fetches the upstream Chatto frontend, builds the runtime, compiles the Rust binary in release mode, and produces platform installers in `src-tauri/target/release/bundle/`.

### Tests

```bash
pnpm test
```

### Reset App State (macOS dev)

```bash
rm -rf ~/Library/Application\ Support/com.solander.app/ \
       ~/Library/WebKit/solander/ \
       ~/Library/Caches/com.solander.app/ \
       ~/Library/Caches/solander/
```

> In dev mode, WebKit stores data under the binary name (`solander`), not the bundle identifier. In release builds it uses `com.solander.app`.

---

## Bumping the Upstream Chatto Ref

Solander pins a specific Chatto release tag in [`scripts/fetch-frontend.mjs`](scripts/fetch-frontend.mjs). To update:

1. Edit the `UPSTREAM_REF` constant in `fetch-frontend.mjs`
2. Run `pnpm fetch-frontend` to verify the build
3. Commit the change

---

## License

Solander is licensed under the [Apache License 2.0](LICENSE).

The bundled Chatto frontend is also Apache-2.0 licensed (per Chatto's [LICENSING.md](https://github.com/chattocorp/chatto/blob/main/LICENSING.md)). Chatto's server and CLI are AGPL-3.0; Solander does not include or link to those components.

"Chatto" and the Chatto logos are marks of ChattoCorp GmbH. Solander is an independent project and is not affiliated with or endorsed by ChattoCorp GmbH.
