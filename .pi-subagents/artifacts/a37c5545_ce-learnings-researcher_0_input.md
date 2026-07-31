# Task for ce-learnings-researcher

Planning context: We're building "Verity", a standalone Tauri v2 desktop wrapper for the Chatto chat frontend (a SvelteKit static SPA at github.com/chattocorp/chatto). The wrapper consumes the pinned upstream frontend build, targets macOS/Windows/Linux, and needs signon (OAuth via system browser + deep link), chat, solid realtime connections, and OS notifications. Voice/screenshare (LiveKit) is deferred. Search the user's past learnings and memory for prior Tauri desktop work (notably the `kapa` project with a `client-tauri/` directory, and any Tauri + Atom experience), Tauri v2 patterns, deep-link handling, notification bridging, and any prior wrapping-a-static-SPA lessons. Report concrete patterns, pitfalls, and file references that should shape this plan.

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