# Task for ce-correctness-reviewer

Review the Solander Tauri v2 desktop wrapper codebase at /Users/jrimmer/work/chatto-desktop for logic errors, edge cases, state management bugs, error propagation failures, and intent-vs-implementation mismatches. Focus on: src-tauri/src/lib.rs (plugin registration, config store, Tauri commands), src-tauri/src/server_config.rs (persistence), src/shell/boot.ts (injection seam), src/shell/oauthClient.ts (OAuth flow), src/shell/notifyBridge.ts (notification bridge), src/shell/connectionStatus.ts (connection monitor), src/shell/server-picker.html (URL validation), scripts/prepare-dist.mjs (build assembly), scripts/fetch-frontend.mjs (upstream fetch).

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