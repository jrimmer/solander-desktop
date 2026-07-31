Now the deliverable research report:

---

# Tauri v2 Wrapper for an Existing SvelteKit Static SPA — Research Findings (2025‑2026)

**Scope.** The wrapper is a *separate* repo that pins and consumes an upstream `apps/frontend/build` output (adapter‑static, SPA fallback). It does **not** embed its own Vite app. Guidance is version‑specific to Tauri v2 (`tauri` 2.x, `@tauri-apps/api` 2.x, plugin workspace `v2`).

Sources are tagged: **[official]** = v2.tauri.app / svelte.dev, **[repo]** = GitHub source/issues, **[community]** = articles/PRs.

---

## 1. `tauri.conf.json` v2 shape — consuming an external SvelteKit build

### 1.1 The critical decision: fallback filename

Your upstream uses `fallback: '200.html'`. **This is the single most likely thing to break**, because Tauri is not a static host — it serves `frontendDist` directly over a custom protocol and never performs a "200.html rewrite."

- **[official]** SvelteKit SPA docs use `fallback: '200.html'` *because hosts like Surge/Vercel map unknown routes to it* (`svelte.dev/docs/kit/single-page-apps`).
- **[official]** The Tauri↔SvelteKit guide instead uses `fallback: 'index.html'` and `frontendDist: "../build"` (`v2.tauri.app/start/frontend/sveltekit/`).

**Why it matters for you:** Tauri loads `index.html` as the app entry. With `200.html` as the only fallback and no prerendered root page, there is **no `index.html`** to load, and client‑side deep routes are never "rewritten" by a server (there is none). Two options:

- **Preferred (no upstream change):** in the *wrapper* repo, copy/rename `build/200.html` → `build/index.html` as part of `beforeBuildCommand` (see 1.3). This keeps the pinned upstream untouched.
- **Alternative:** ask upstream to emit `fallback: 'index.html'` (SvelteKit warns this can conflict with prerendering; since you're pure SPA with `ssr = false`, it's safe) *and* keep `200.html` for the web host. adapter‑static only supports one fallback name, so the copy step in the wrapper is the cleanest seam.

Also confirm upstream has `export const ssr = false` in the root `+layout.ts` and `paths.relative` is acceptable — note the fallback page **always** uses absolute asset paths (`/…`) regardless of `paths.relative` **[official]**. Under the `tauri://` custom protocol, absolute `/` resolves to the protocol root, which is correct for Tauri.

### 1.2 Config shape (wrapper repo, e.g. `src-tauri/tauri.conf.json`)

```jsonc
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "YourApp",
  "version": "0.1.0",
  "identifier": "com.yourco.yourapp",
  "build": {
    // Vite dev server of the UPSTREAM frontend (dev only)
    "devUrl": "http://localhost:5173",
    // Path to the pinned upstream build output, resolved relative to src-tauri/.
    // Parent traversal outside src-tauri is supported.
    "frontendDist": "../../apps/frontend/build",
    "beforeDevCommand": "pnpm --filter frontend dev",
    "beforeBuildCommand": "pnpm --filter frontend build && node scripts/prepare-dist.mjs"
  },
  "app": {
    "security": { "csp": null },   // see §4 — do NOT ship null in production
    "windows": [{ "label": "main", "title": "YourApp", "width": 1280, "height": 800 }]
  },
  "bundle": { "active": true, "targets": "all", "icon": ["icons/32x32.png","icons/128x128.png","icons/128x128@2x.png","icons/icon.icns","icons/icon.ico"] },
  "plugins": {}
}
```

**Notes / pitfalls**
- **[official]** `frontendDist` is resolved **relative to `src-tauri/`** and `../…` parent traversal is the documented pattern (`"../build"`, `"../dist"`). For a monorepo the path is `../../apps/frontend/build`; for a truly separate repo, either vendor the build into the wrapper (recommended for reproducibility) or point at a checked‑out sibling path.
- **[repo]** Avoid a top‑level folder literally named `target` inside `frontendDist` — the bundler errors on it (tauri issue #13287).
- `identifier` must be a stable reverse‑DNS string; it drives the macOS bundle id and the deep‑link/universal‑link configuration later.
- Pin `@tauri-apps/cli` and the `tauri` crate to the same minor line to avoid schema drift (`https://schema.tauri.app/config/2`).

### 1.3 `beforeBuildCommand` driving the upstream pnpm build + the rename seam

`beforeBuildCommand` runs in the wrapper repo root (the CLI's cwd is the Tauri project dir). Drive the upstream build and normalize the output in one step:

```jsonc
"beforeBuildCommand": "pnpm -C ../frontend-repo install --frozen-lockfile && pnpm -C ../frontend-repo build && node scripts/prepare-dist.mjs"
```

`scripts/prepare-dist.mjs` (wrapper repo):
```js
import { copyFileSync, existsSync } from 'node:fs';
const dist = new URL('../../apps/frontend/build/', import.meta.url);
if (!existsSync(new URL('index.html', dist)) && existsSync(new URL('200.html', dist))) {
  copyFileSync(new URL('200.html', dist), new URL('index.html', dist));
  console.log('[prepare-dist] mapped 200.html -> index.html for Tauri entry');
}
```

For a **separate** wrapper repo (not a monorepo), prefer vendoring: a CI step downloads the pinned upstream artifact into `vendor/frontend/build`, and `frontendDist` points at `../vendor/frontend/build`. That decouples the desktop release from upstream's build system.

---

## 2. OAuth sign‑in: system browser + deep‑link / loopback

The webview origin under Tauri is a custom scheme — **`tauri://localhost`** (macOS/Linux) and **`http://tauri.localhost`** (Windows). A `tauri://` URL **cannot** be registered as an OAuth redirect with mainstream providers, and you should not run the flow inside the webview (no secure cookies, providers block embedded webviews). The correct pattern is **system browser → redirect back to the app**.

### 2.1 Recommended plugin set

| Concern | Plugin | Why |
|---|---|---|
| Open the system browser | **`tauri-plugin-opener`** (`openUrl`) | Default permission already allows `https://`/`http://` **[official]** |
| Receive the redirect | **`tauri-plugin-deep-link`** (desktop custom scheme, e.g. `yourapp://auth/callback`) | Registers OS protocol handler |
| One running app | **`tauri-plugin-single-instance`** (with `deep-link` feature) | **Required** — see pitfall below |
| Loopback alternative | **`@fabianlars/tauri-plugin-oauth`** (community, FabianLars) | Spawns a temporary localhost server to capture the redirect |

### 2.2 The single‑instance pitfall (this bites everyone)

**[official + repo]** On **Windows and Linux**, a deep link is delivered as a **command‑line argument to a NEW process** — the OS launches a second copy of your app with `yourapp://…` in `argv`. Without single‑instance, the user gets a second window and the original window never receives the callback (real‑world report: gethouston/houston commit 34dfc23, tauri issue #12726).

Wire it exactly like this — **single‑instance must be the FIRST registered plugin**:

```toml
# src-tauri/Cargo.toml
[target."cfg(any(target_os = \"macos\", windows, target_os = \"linux\"))".dependencies]
tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }
tauri-plugin-deep-link = "2"
```

```rust
// src-tauri/src/lib.rs
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            // deep-link event is already triggered; argv carries the URL on Win/Linux
            println!("second instance: {argv:?}");
        }));
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .run(tauri::generate_context!())
        .expect("run failed");
}
```

Register the scheme in `tauri.conf.json`:
```jsonc
"plugins": { "deep-link": { "desktop": { "schemes": ["yourapp"] } } }
```

Frontend listener:
```ts
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
const start = await getCurrent();          // cold start via deep link
await onOpenUrl((urls) => { /* warm start */ });
```

Capabilities (required — plugin commands are denied by default): add `"deep-link:default"` and `"core:event:default"` to your capability. **[official]**

### 2.3 Custom scheme vs loopback — choose by provider

- **Custom scheme (`yourapp://`)** is the smoothest UX and works with providers that allow native schemes (Auth0, Keycloak, Supabase, most OIDC).
- **[community] Loopback (`http://127.0.0.1:<port>/callback`)** is required when the provider **forbids custom schemes** — notably **Google and GitHub** (`FabianLars/tauri-plugin-oauth` README: "Many OAuth providers (like Google and GitHub) don't allow custom URI schemes as redirect URLs"). That plugin spawns a temp localhost server, captures the redirect, and can `302` the browser onward (`redirect_uri` config). Note: with `redirect_uri` set, the handler receives the localhost URL **without** the `#fragment` — if your flow returns tokens in the fragment (implicit), parse `window.location` on the landing page yourself (use PKCE/auth‑code instead and this is moot).

**Recommendation:** design the auth module against an abstraction (`startOAuthFlow(): Promise<Token>`) with two strategies — deep‑link and loopback — and pick per provider. That leaves the seam for whichever IdP you integrate.

---

## 3. Notifications + app badge — and how they collide with the web flow

### 3.1 The web‑Notification trap

**[repo, important]** Two things silently break an existing browser notification flow inside the Tauri webview:

1. **Service Workers do not run under the `tauri://` custom protocol.** Any logic that lives in `sw.js` (push, `registration.showNotification`) **never executes**. Real report: hermes-desktop issue #32 — "Web Notifications API isn't available in the webview, so every notification silently no‑ops."
2. **`tauri-plugin-notification` injects its own `window.Notification`.** It shadows the native class and forwards calls over IPC to `plugin:notification|notify` (tauri core.js injection; see plugins‑workspace issue #2150 and openhuman's TAURI_CEF findings). So "it works on its own in the frontend" is an illusion — calls are being routed through the plugin, **not** the browser/OS path.

**Consequence for your wrapper:** the pinned frontend's existing `Notification.requestPermission()` / `new Notification(...)` will *appear* to work only because the plugin shadows it. Do not rely on the SW path. The robust pattern is to **bridge**: detect Tauri and call the plugin API directly.

```ts
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
const isTauri = '__TAURI__' in window;
export async function notify(title: string, body: string) {
  if (isTauri) {
    if (!(await isPermissionGranted())) {
      if ((await requestPermission()) !== 'granted') return;
    }
    sendNotification({ title, body });
  } else {
    // existing web Notification / SW path
  }
}
```

Windows caveat: notifications **only work for installed apps** (dev shows a PowerShell icon/name). **[official]**

### 3.2 App badge (unread count)

**[official/repo]** Badging landed in **`tauri` 2.2.0 / `@tauri-apps/api` 2.2.0** (PR #11661) and is per‑window, called from JS or Rust:

- `window.setBadgeCount(n | undefined)` — macOS, Linux, iOS
- `window.setBadgeLabel(s)` — **macOS only**
- `window.setOverlayIcon(icon)` — **Windows only**

```ts
import { getCurrentWindow } from '@tauri-apps/api/window';
const win = getCurrentWindow();
await win.setBadgeCount(unread > 0 ? unread : undefined); // undefined clears
```

Pattern (mirrors dohooo/helmor's dock badge): derive the count from the frontend's existing unread state and call `setBadgeCount` reactively; pass `undefined` at zero to clear. On Windows there is no numeric badge — use `setOverlayIcon` with a pre‑rendered dot/count icon instead.

---

## 4. Connecting to a user‑configurable remote backend

### 4.1 CORS reality

The webview sends an **`Origin` of `tauri://localhost`** (or `http://tauri.localhost` on Windows). Any plain `fetch()` to your remote API is a cross‑origin browser request and **will be blocked by CORS** unless the server returns matching `Access-Control-Allow-Origin` headers — which you usually don't control for a *user‑configurable* server (tauri issues #2327, #11770; cors‑handbook).

You have three options, in order of preference for a *user‑supplied* URL:

1. **`tauri-plugin-http` (recommended).** A reqwest‑backed `fetch` that runs in Rust and **bypasses CORS entirely** (no browser origin). Configure the scope by URL glob; for a dynamic server URL you can allow broad patterns and validate at runtime:

```jsonc
// capability
{
  "permissions": [
    { "identifier": "http:default",
      "allow": [{ "url": "https://*" }, { "url": "http://*" }] }
  ]
}
```
```ts
import { fetch } from '@tauri-apps/plugin-http';
const res = await fetch(`${serverUrl}/api/v1/...`, { method: 'GET' });
```
Trade‑off: a wide `https://*` scope is a real security relaxation — the frontend can exfiltrate to any host. Tighten by validating the configured URL in Rust before issuing, or proxy (option 2).

2. **Rust localhost proxy.** Run a small in‑process server (e.g. via `tauri-plugin-localhost` or a custom `axum`/`tiny_http` command) that the webview calls same‑origin; Rust forwards to the configured backend. This centralizes auth header injection and avoids wide HTTP scopes, at the cost of more moving parts. Only needed if you also must hide tokens from the webview or normalize several upstream APIs.

3. **Rely on the server's CORS.** Only viable if you control every possible backend the user might point at — you don't. Skip.

**Bottom line:** use `tauri-plugin-http` with runtime URL validation; a localhost proxy is *not* required for CORS alone.

### 4.2 CSP `connect-src` for a dynamic URL

Tauri's CSP is static, set at compile time in `app.security.csp`; **Tauri auto‑appends nonces/hashes** to bundled assets, so you only declare what's unique to your app **[official]**. You cannot enumerate a user‑supplied host at build time, so use scheme wildcards for the connect class and keep everything else tight:

```jsonc
"app": {
  "security": {
    "csp": {
      "default-src": "'self' tauri: asset:",
      "connect-src": "ipc: http://ipc.localhost https: wss:",
      "img-src": "'self' asset: http://asset.localhost blob: data:",
      "style-src": "'unsafe-inline' 'self'",
      "media-src": "'self' blob: mediastream:"
    }
  }
}
```

- `connect-src … https: wss:` covers any HTTPS/WSS backend the user configures (needed for the API **and** for future LiveKit/WebRTC signaling).
- `ipc: http://ipc.localhost` is required for Tauri's own IPC.
- Keep `default-src 'self'` — do **not** ship `"csp": null` in production.
- If you adopt the Rust proxy (option 2), you can drop `https:` from `connect-src` and point the webview at the loopback origin instead — a meaningfully tighter posture.

---

## 5. Cross‑platform CI via `tauri-action`

**[official]** Use `tauri-apps/tauri-action@v1` with a build matrix. Cross‑compilation is not supported; you build natively per OS.

```yaml
name: publish
on: { push: { tags: ['app-v*'] } }
jobs:
  publish-tauri:
    permissions: { contents: write }
    strategy:
      fail-fast: false
      matrix:
        include:
          - { platform: macos-latest, args: '--target aarch64-apple-darwin' }
          - { platform: macos-latest, args: '--target x86_64-apple-darwin' }
          - { platform: ubuntu-22.04,  args: '' }
          - { platform: windows-latest, args: '' }
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - name: Linux deps
        if: contains(matrix.platform, 'ubuntu')
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: lts/*, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
      - uses: swatinem/rust-cache@v2
        with: { workspaces: './src-tauri -> target' }
      - run: pnpm install --frozen-lockfile
      - uses: tauri-apps/tauri-action@v1
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        with:
          tagName: app-v__VERSION__
          releaseDraft: true
          args: ${{ matrix.args }}
```

Since `beforeBuildCommand` drives the upstream build, that command must be CI‑safe (the upstream repo checked out, or the vendored artifact restored) before `tauri-action` runs.

### What breaks on Linux WebKitGTK

- **[repo] WebRTC / `getUserMedia` / `getDisplayMedia` do not work.** WebKitGTK denies any permission request the embedder doesn't handle, and wry's WebKitGTK backend registers **no `permission-request` handler** — so `getUserMedia()` always rejects (wry#85, tauri#8346, block/buzz PR #2481). "No ETA" per maintainer.
- **[official]** Build deps are `libwebkit2gtk-4.1-dev` (not 4.0), plus `libappindicator3-dev librsvg2-dev patchelf xdg-utils`.
- Wayland/X11 rendering quirks and older distro WebKitGTK versions are the most common source of "works on my Mac, broken on Ubuntu" reports; pin CI to `ubuntu-22.04`+ and treat Linux as the tier‑2 target for anything media‑related.

---

## 6. Future WebRTC / LiveKit readiness — leave the right seams now

You don't need to build voice/screenshare yet, but set up four seams so you don't have to re‑architect:

1. **CSP** — already includes `wss:` and `https:` in `connect-src` and `mediastream: blob:` in `media-src` (§4.2). LiveKit signaling is WSS; media uses `mediastream:`/`blob:`.

2. **macOS entitlements + usage strings (add now, even unused).** Without these, mic/camera fail opaquely later:
```xml
<!-- src-tauri/Info.plist (or embedded plist) -->
<key>NSCameraUsageDescription</key><string>Used for video calls</string>
<key>NSMicrophoneUsageDescription</key><string>Used for voice calls</string>
```
```xml
<!-- src-tauri/Release.entitlements -->
<key>com.apple.security.device.audio-input</key><true/>
<key>com.apple.security.device.camera</key><true/>
```
   And reference the entitlements under `bundle.macOS.entitlements`.

3. **Know the per‑platform media gaps (so you scope the feature correctly):**
   - **macOS:** permission prompts were broken on 14.5 / tauri rc8 (tauri#10878); `getUserMedia` can prompt **twice** (app‑level + webview‑level) and `getDisplayMedia` depends on wry delegating `requestMediaCapturePermissionForOrigin` to `SCContentSharingPicker` (wry#1195). Verify on a current stable before promising screenshare.
   - **Windows (WebView2):** native permission prompts appear; `getDisplayMedia` historically had issues (tauri#2600).
   - **Linux (WebKitGTK):** **no WebRTC at all** (§5). Plan to gate the feature or use a Rust‑side capture path on Linux.
   - **[repo]** wry recently added `with_permission_handler` (wry#1656); a Tauri feature request (tauri#14753) tracks exposing it — this is the seam that would let you auto‑grant/curate media permissions later.

4. **Frontend abstraction.** Route all media acquisition through one module (`getMic()`, `getScreen()`, `joinRoom()`) that today just throws "unsupported," so the LiveKit client and `livekit-client` SDK can drop in behind it without touching call sites.

**Reality check:** as of early 2026, full LiveKit voice+screenshare is realistically **macOS + Windows only** inside a Tauri webview; Linux WebKitGTK remains the blocker until WebKitGTK ships WebRTC capture.

---

## Plugin install cheat‑sheet

```bash
pnpm tauri add opener
pnpm tauri add deep-link
pnpm tauri add single-instance   # + features=["deep-link"] in Cargo.toml
pnpm tauri add notification
pnpm tauri add http
# loopback OAuth (community):
pnpm add @fabianlars/tauri-plugin-oauth@2   # + tauri-plugin-oauth = "2" in Cargo.toml
```

Minimum capability permissions: `core:event:default`, `deep-link:default`, `notification:default`, `opener:default`, plus scoped `http:default`.

---

## Key risks / residual concerns

- **R1 (high):** upstream `fallback: '200.html'` produces no `index.html` → Tauri has no entry. Mitigate with the `prepare-dist.mjs` rename seam (§1.1/1.3).
- **R2 (high):** Linux WebKitGTK has **no WebRTC** — LiveKit voice/screenshare cannot ship there via the webview.
- **R3 (medium):** wide CSP `connect-src https: wss:` and broad `http` plugin scope are deliberate relaxations for a user‑configurable backend; tighten via runtime URL validation or the Rust proxy if threat model requires.
- **R4 (medium):** existing SW/web‑Notification flow silently no‑ops in the webview; must bridge to `tauri-plugin-notification`.
- **R5 (low):** on Windows/Linux, forgetting single‑instance (first plugin, `deep-link` feature) breaks OAuth deep‑link delivery.

---