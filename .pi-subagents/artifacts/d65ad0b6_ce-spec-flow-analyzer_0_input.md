# Task for ce-spec-flow-analyzer

Analyze user-flow completeness for a plan to build "Verity", a Tauri v2 desktop wrapper for the Chatto chat frontend (SvelteKit static SPA, github.com/chattocorp/chatto, consumed as a pinned upstream build in a separate wrapper repo). Targets macOS/Windows/Linux. v1 scope: app launches, user points it at a Chatto server URL, signs in (OAuth via system browser + deep-link redirect back to app, bearer token stored), chats, keeps a solid realtime connection (native WebSocket to the server), gets OS notifications + app badge. Voice/screenshare (LiveKit) explicitly deferred but seams left (CSP, macOS entitlements, media abstraction).

Key known integration facts the frontend already has: multi-server registry persisted in localStorage (RegisteredServer with per-server bearer token); root +layout.ts currently discovers the server from its OWN origin (url.origin) which under tauri://localhost is wrong — wrapper must inject the configured server URL before that load; OAuth popup flow uses cross-window postMessage (oauth/popup.ts) which won't work in a webview, so desktop must use system-browser + deep-link instead; service workers don't run under tauri:// so web push no-ops and notifications must be bridged to tauri-plugin-notification; Tauri needs index.html but upstream emits 200.html fallback (wrapper renames); deep-link OAuth on Windows/Linux requires single-instance plugin.

Identify missing user flows, edge cases, state transitions, and handoff gaps the plan must address: e.g. first-run server-URL entry, invalid/unreachable server, auth failure/re-auth, token expiry, multi-server switching in desktop, offline/reconnect behavior, notification-click navigation into the webview, sign-out, and what happens on Linux where notifications/WebRTC differ. Return a concise list of flows/edge cases to enumerate, not implementation.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return a concise result and residual risks when applicable

Required evidence: manual-notes, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```