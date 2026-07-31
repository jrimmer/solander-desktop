# Task for ce-best-practices-researcher

Research current (2025-2026) best practices for wrapping an existing SvelteKit static SPA (adapter-static, fallback 200.html, output in apps/frontend/build) in Tauri v2 as a desktop app. The wrapper is a SEPARATE repo that consumes the pinned upstream frontend build — it does not embed its own Vite app. Focus on: (1) tauri.conf.json v2 shape: build.frontendDist pointing at the SvelteKit build output dir, build.devUrl at the Vite dev server, and how beforeBuildCommand drives the upstream pnpm build; (2) OAuth sign-in from a Tauri v2 webview via system browser + deep-link/loopback redirect — recommended plugins (tauri-plugin-deep-link, tauri-plugin-opener, single-instance) and pitfalls under the tauri:// custom scheme; (3) OS notification + app-badge patterns in Tauri v2 (tauri-plugin-notification) and how they interact with an existing web Notification/service-worker flow inside the webview; (4) connecting to a user-configurable remote backend URL from the webview — CORS, whether a localhost Rust proxy is needed, and how tauri CSP connect-src must be set for a dynamic server URL; (5) cross-platform CI build for macOS/Windows/Linux via tauri-action, and what breaks on Linux WebKitGTK; (6) Tauri v2 readiness for FUTURE WebRTC/LiveKit voice+screenshare (getDisplayMedia, mic/camera permissions, entitlements) so we leave the right seams without building it. Return concrete, version-specific guidance with config snippets and plugin names.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

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