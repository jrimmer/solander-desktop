Now I have a complete picture. Let me compile the security review findings.

```json
{
  "reviewer": "security",
  "findings": [
    {
      "id": "F1",
      "title": "Missing CSRF state validation in OAuth callback — authorization code injection",
      "severity": "P0",
      "confidence": 75,
      "files": ["src/shell/oauthClient.ts"],
      "description": "The OAuth 2.0 authorization code flow requires the client to generate a random `state` value, include it in the authorization request, and verify it matches when the callback arrives. The deepLinkFlow and loopbackFlow functions never generate a `state` parameter before opening the browser, and never validate the `state` parameter in the callback URL. The `state` parameter is mentioned in the doc comment (line 65) but is never implemented. Without state validation, an attacker can craft a `solander://auth/callback?code=ATTACKER_CODE` URL and trick the user into clicking it. The app will accept the attacker's authorization code and exchange it for a token, linking the attacker's account to the victim's session. The plan document explicitly calls for this: 'On callback, validate state' and 'Error path: state mismatch → callback rejected (CSRF guard).'",
      "attack_path": "1. Attacker initiates their own OAuth flow with the Chatto server → gets a valid authorization code. 2. Attacker crafts solander://auth/callback?code=ATTACKER_CODE and delivers it to victim (email, chat, etc.). 3. Victim's Solander app receives the deep-link callback. 4. The code is accepted without state validation. 5. The code is exchanged for a bearer token linked to the attacker's account. 6. Victim is now authenticated as the attacker.",
      "remediation": "Generate a cryptographically random state value before opening the browser URL. Store it in memory. When the callback arrives, parse the state parameter from the URL and compare it against the stored value. Reject the callback if they don't match."
    },
    {
      "id": "F2",
      "title": "Deep-link URL prefix check allows path confusion",
      "severity": "P1",
      "confidence": 75,
      "files": ["src/shell/oauthClient.ts"],
      "lines": [91, 103],
      "description": "The deep-link callback check uses `url.startsWith(\"solander://auth/callback\")` which would also match URLs like `solander://auth/callback-evil` or `solander://auth/callback-fake`. While `new URL()` would parse the path correctly later, the prefix check is too loose and could allow unexpected URLs to enter the callback processing pipeline.",
      "remediation": "Use URL parsing to verify the pathname is exactly `/auth/callback` instead of a string prefix check. E.g.: `const u = new URL(url); if (u.protocol === 'solander:' && u.pathname === '/auth/callback')`"
    },
    {
      "id": "F3",
      "title": "Overly permissive tauri-plugin-http scope allows requests to any URL",
      "severity": "P1",
      "confidence": 75,
      "files": ["src-tauri/capabilities/default.json"],
      "description": "The HTTP scope allows requests to `https://*` and `http://*` (any URL). This means: (1) any XSS in the webview can exfiltrate data to any server, (2) the app can be used as an SSRF proxy to internal networks, (3) unencrypted HTTP (`http://*`) is allowed unnecessarily. While the app needs to connect to arbitrary Chatto servers, the scope should be narrowed.",
      "remediation": "Remove `http://*` (only HTTPS should be allowed). Consider dynamically scoping the permission to the configured server URL at runtime, or at minimum restrict to `https://*` only."
    },
    {
      "id": "F4",
      "title": "Bearer token stored in plaintext localStorage",
      "severity": "P2",
      "confidence": 75,
      "files": ["docs/plans/2026-07-30-001-feat-solander-tauri-wrapper-plan.md"],
      "description": "Per the plan document: 'Token storage: keep the frontend's localStorage RegisteredServer for v1.' The bearer token is stored in plaintext in localStorage, which is accessible to any JavaScript running in the webview. If an attacker achieves XSS, they can steal the token. This is a documented v1 decision with keychain deferred to follow-up, but represents a significant residual risk.",
      "remediation": "Migrate token storage to OS keychain (e.g., tauri-plugin-stronghold or platform keychain APIs) in a follow-up. For v1, at minimum ensure the token is not logged or exposed in error messages."
    },
    {
      "id": "F5",
      "title": "No SSRF protection in server URL input — allows internal network targets",
      "severity": "P2",
      "confidence": 50,
      "files": ["src/shell/server-picker.html"],
      "description": "The server-picker.html validates that the URL is syntactically valid and uses http/https, but does not block internal IP addresses (127.0.0.1, 10.x.x.x, 172.16-31.x.x, 192.168.x.x), localhost hostnames, or URLs with embedded credentials (user:pass@host). A user could be tricked into entering an internal address, causing the app to connect to an internal service and potentially leak data or be used as a pivot point.",
      "remediation": "Add validation to reject private IP ranges and localhost. At minimum, warn the user when connecting to a non-public address."
    },
    {
      "id": "F6",
      "title": "Loopback OAuth backend commands not implemented — dead code path",
      "severity": "P3",
      "confidence": 100,
      "files": ["src/shell/oauthClient.ts", "src-tauri/src/lib.rs"],
      "description": "The `loopbackFlow` function calls `invoke(\"start_oauth_server\")` and `invoke(\"poll_oauth_callback\", { port })`, but these commands are not registered in `lib.rs`'s `invoke_handler`. Only `get_server_url`, `set_server_url`, and `clear_server_url` are registered. The loopback flow will fail at runtime with a command-not-found error.",
      "remediation": "Implement the `start_oauth_server` and `poll_oauth_callback` Tauri commands in the Rust backend, or remove the loopback strategy if it's not needed."
    },
    {
      "id": "F7",
      "title": "Second-instance argv logged to stdout — potential sensitive data leak",
      "severity": "P3",
      "confidence": 50,
      "files": ["src-tauri/src/lib.rs"],
      "lines": [24],
      "description": "The single-instance callback logs `argv` to stdout: `println!(\"[solander] second-instance argv: {argv:?}\");`. If argv contains sensitive data (e.g., OAuth codes or tokens in deep-link URLs), this would be written to stdout/logs which could be captured in log files or crash reports.",
      "remediation": "Remove the debug println or sanitize argv before logging. Only log the fact that a second instance was detected, not the full argv contents."
    },
    {
      "id": "F8",
      "title": "CSP allows 'unsafe-inline' for styles — weakens XSS defense-in-depth",
      "severity": "P3",
      "confidence": 50,
      "files": ["src-tauri/tauri.conf.json"],
      "description": "The CSP includes `style-src 'unsafe-inline'` which allows inline style elements. While common in SPAs and not a direct vulnerability, it weakens the CSP's ability to mitigate XSS attacks. Combined with the permissive connect-src (https://*), an XSS could exfiltrate data to any server.",
      "remediation": "If the SPA supports it, use a nonce or hash-based CSP for styles instead of 'unsafe-inline'. If not possible, document the accepted risk."
    }
  ],
  "residual_risks": [
    "Token in plaintext localStorage: The bearer token is stored in the frontend's localStorage (RegisteredServer registry) per the v1 design decision. Any XSS in the webview can exfiltrate the token. Keychain migration is deferred to follow-up work.",
    "Wide connect-src CSP: The CSP allows connect-src to any https:// and wss:// host. This is inherent to the app's design (connecting to arbitrary Chatto servers) but means CSP cannot prevent data exfiltration to arbitrary hosts if XSS occurs.",
    "No hardcoded secrets found — credential hygiene is clean.",
    "The loopback OAuth strategy is non-functional (missing Rust commands) — only deep-link strategy works in practice."
  ],
  "testing_gaps": [
    "No test for CSRF state validation (because it's not implemented)",
    "No test for deep-link URL path validation (prefix check edge cases)",
    "No test for SSRF protection in server URL input",
    "No integration test for the full OAuth round-trip with a real/mocked server",
    "No test for token storage security (localStorage vs keychain)"
  ]
}
```