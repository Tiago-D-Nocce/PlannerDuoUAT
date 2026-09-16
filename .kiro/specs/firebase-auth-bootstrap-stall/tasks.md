# Implementation Plan

## Overview

This plan follows the existing bugfix sequence: Tasks 1 and 2 independently establish the unfixed baseline, Task 3 implements and verifies the fix, Task 4 validates the complete local change set, and Tasks 5 and 6 remain separate explicit approval gates for preview and production publication.

## Tasks

### Execution Rules

- Execute in order: explore on unfixed code, preserve the baseline, implement, validate, then publish only with explicit human approval.
- Do not use real credentials, Auth users, tokens, Firestore documents or production data in tests. All Auth, storage, scheduler, DOM and navigation behavior must be faked locally.
- Do not add a dependency: Vitest and fast-check are already available.
- Do not commit or push as part of these tasks unless separately requested.
- Do not start a development server from an automated agent session. For the HTTP verifier, ask the user to run `npm run dev` manually in another terminal and stop it after validation.
- Preview and production publication are high-risk manual gates. Never execute Tasks 5 or 6 without fresh, explicit approval.

- [x] 1. Write the bug-condition exploration property before changing product code
  - **Property 1: Bug Condition** - Auth bootstrap accepts late valid completion and always has a safe exit
  - **CRITICAL**: This test MUST FAIL on the unfixed `9ebdd40` code; failure proves the production regression is represented.
  - **DO NOT** weaken the property, extend the old 3-second terminal threshold or modify product code when the first run fails.
  - Create `tests/firebase-auth-bootstrap-stall.test.js` (or a behaviorally equivalent isolated test file) with a fake scheduler, deferred Promise, fake Firebase Auth adapter, minimal DOM/supervisor UI and injectable navigation.
  - Model the `isBugCondition(X)` branches from `design.md`: late SESSION success, recoverable storage interference on the app page, non-owned rejection, valid sequential phases above the aggregate 10-second ceiling, and failed navigation after premature completion.
  - **Scoped deterministic case**: make SESSION remain pending through 3000 ms, fire the current limiter, then resolve at 3001 ms; assert that expected behavior is `observerCalls === 1`, authenticated shell visible and no terminal recovery.
  - Add fast-check generators for delays in `[3001, 30000]`, phase durations that each satisfy their own contract while their sum exceeds 10000, event orderings, storage outcomes and navigation outcomes; run at least 100 cases.
  - Assert `expectedBehavior(result, X)` from the design for every generated input satisfying `isBugCondition(X)`.
  - Run only this test on unfixed code with `npx vitest --run tests/firebase-auth-bootstrap-stall.test.js`.
  - **EXPECTED OUTCOME**: FAILURE. The minimal expected counterexample is `delayMs = 3001`, where the current flow reports recovery and never starts the observer.
  - Record the seed, shrunk counterexample, observed supervisor state and observer call count in a test comment or adjacent test fixture; do not include error payloads, identity values or cloud data.
  - Mark complete only after the test is written, run against unfixed code and its expected failure is documented.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 2. Write preservation properties on unfixed code before implementing the fix
  - **Property 2: Preservation** - Session-by-tab policy, critical recovery and offline fallback remain unchanged
  - **IMPORTANT**: Follow observation-first methodology and keep this task independent of Task 1.
  - Extend the local harness so it can observe only public outcomes: selected persistence kind, credential operation count, observer count, destination, loader/app visibility, recovery category, fallback ID use and sanitized diagnostic fields.
  - Observe and record the unfixed behavior for non-bug inputs: SESSION resolves in `[0, 3000]`; user is absent; required SDK/observer fails explicitly; `resolverCasalId` rejects or times out; local cache access throws; shell mounts normally; logout rejects.
  - Write a fast-check property for `NOT isBugCondition(X)` that captures those observed outcomes and uses at least 100 cases.
  - Assert that a real storage-policy failure before a new login starts zero credential operations and never selects LOCAL.
  - Assert that required-resource and observer failures remain actionable, unauthenticated app access targets `auth.html`, Firestore fallback still opens the shell, and diagnostics contain no generated secret fields.
  - Run the preservation tests on unfixed code with `npx vitest --run tests/firebase-auth-bootstrap-stall.test.js tests/auth-bootstrap.test.js tests/auth-errors.test.js tests/app-saneamento.test.js`.
  - **EXPECTED OUTCOME**: PASS. This establishes the baseline that the implementation must preserve.
  - Mark complete only after the observations are encoded and all preservation assertions pass before product changes.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Fix the Firebase Auth bootstrap stall

  - [x] 3.1 Implement the minimal owned, phase-aware bootstrap flow
    - In `public/app.js`, remove the app-page `persistenciaAuth` terminal gate and the redundant `setPersistence(SESSION)` call; start `Auth.iniciarObserver()` directly from `DOMContentLoaded` and keep explicit observer error handling.
    - In `public/auth.html`, retain the single `setPersistence(SESSION)` prerequisite before login, cadastro and Google redirect, but wait for its actual settlement. A timer may mark the phase as delayed; it must not synthesize rejection, discard late success or fall back to LOCAL.
    - On actual storage rejection before a new login, keep credential operation count at zero and show the existing safe storage-specific message. Consume owned rejections so no orphan `unhandledrejection` is created.
    - In `public/bootstrap.js`, add a recoverable delayed/progress state or equivalent phase mechanism: late success can still conclude, and advancing from SDK → Auth → shared-data resolution → rendering resets the relevant timer instead of accumulating against one absolute fatal budget.
    - Remove `unhandledrejection` as an unscoped fatal transition. Route failures only from explicitly owned critical operations; a global listener, if retained for diagnostics, must not change bootstrap state or serialize raw reasons.
    - In `public/app.html` and `public/auth.html`, explicitly identify required scripts whose load failure is fatal; optional presentation assets must not decide bootstrap success.
    - In `Auth._redirecionar`, do not call `PlannerBootstrap.concluir()` before the page exits. Catch navigation exceptions, clear `_navegando` and leave/call the supervisor in a recoverable state so a no-exit path cannot strand an already-ready loader.
    - Preserve `resolverCasalId` and its 6-second fallback, cache guards, one-time shell mount, error allowlist, logout ordering, Firebase SDK version, Hosting config and Firestore rules/data model.
    - Replace current string-presence tests that require a “gate terminal” with behavioral state/call-count tests. Keep inline-script syntax and asset-order tests.
    - Do not add dependencies, credentials, emulator users or any network access to Auth/Firestore.
    - _Bug_Condition: `isBugCondition(X)` from design, covering `C_late ∪ C_storage ∪ C_unowned ∪ C_budget ∪ C_navigation`_
    - _Expected_Behavior: `expectedBehavior(result, X)` from design; valid authenticated startup opens the app, while unrecoverable policy/critical failures end in specific actionable recovery_
    - _Preservation: Preservation Requirements from design, especially SESSION-before-new-login, no LOCAL fallback, unauthenticated redirect, critical-resource recovery, offline fallback and sanitized diagnostics_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 3.2 Verify the original exploration property now passes
    - **Property 1: Expected Behavior** - Auth bootstrap accepts late valid completion and always has a safe exit
    - **IMPORTANT**: Re-run the SAME property and generators from Task 1; do not create a replacement test or remove the recorded counterexample.
    - Run `npx vitest --run tests/firebase-auth-bootstrap-stall.test.js`.
    - Confirm the former `delayMs = 3001` counterexample now starts the observer and opens the shell.
    - Confirm storage classification, non-owned rejection, aggregate timing and navigation-failure branches also satisfy `expectedBehavior`.
    - **EXPECTED OUTCOME**: PASS with at least 100 generated cases and no skipped branch.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.3 Verify the preservation properties still pass
    - **Property 2: Preservation** - Session-by-tab policy, critical recovery and offline fallback remain unchanged
    - **IMPORTANT**: Re-run the SAME observations/properties from Task 2; do not rewrite expected values after seeing the fixed output.
    - Run `npx vitest --run tests/firebase-auth-bootstrap-stall.test.js tests/auth-bootstrap.test.js tests/auth-errors.test.js tests/app-saneamento.test.js`.
    - Confirm SESSION is still the only selected persistence before a new login, actual critical failures still recover visibly, unauthenticated access still redirects, and Firestore/cache fallback still opens the app.
    - Confirm diagnostics remain allowlisted and generated secrets never appear in logs or UI.
    - **EXPECTED OUTCOME**: PASS with no regression and no use of real Firebase services.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 4. Checkpoint - Validate the complete local change set
  - Run `npm test`; all existing and new tests must pass in single-run mode.
  - Run `node --check public/bootstrap.js`, `node --check public/auth-errors.js` and `node --check public/app.js`; rely on the existing inline-script VM test for `auth.html`/`app.html` syntax.
  - Inspect `git diff -- public tests .kiro/specs/firebase-auth-bootstrap-stall` and confirm the change is limited to the designed bootstrap/auth behavior, tests and spec; do not alter Firebase config, Firestore rules or data.
  - Confirm no fixture contains an actual e-mail, password, API token, Auth user, UID or document payload; use reserved examples such as `pessoa@example.invalid` and generated opaque placeholders.
  - For HTTP smoke validation, ask the user to run `npm run dev` manually in another terminal. Once they confirm it is running, execute `npm run verificar`, then ask them to stop the server. Do not start a server/watcher from the agent.
  - Manually exercise the fake-browser integration matrix (not production Auth): late SESSION success, blocked storage, corrupt storage, unrelated rejection, slow valid phases, missing required SDK and failed navigation.
  - Ensure every path ends in app visible, navigation, or actionable recovery with `aria-busy=false`; no path may leave a ready supervisor behind an occupied loader.
  - If any check fails, fix it and repeat Tasks 3.2, 3.3 and this checkpoint before proceeding.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 5. Publish and validate a Firebase Hosting preview (manual approval gate)
  - **STOP FOR EXPLICIT APPROVAL** before any remote command. This task publishes public static assets to a preview channel; it must never run automatically.
  - Re-run `npm test` immediately before publication and retain the passing summary plus the local Git diff for review. Do not commit or push unless separately requested.
  - After approval, publish only Hosting assets to a named preview channel with `firebase hosting:channel:deploy firebase-auth-bootstrap-stall --project plannerduo`; do not deploy Firestore rules/functions and do not read Auth or Firestore data.
  - Verify the preview’s public `/bootstrap.js`, `/auth`, `/app` and `/app.js` contain the reviewed release logic and expected no-cache headers. Compare public asset content/hashes with local `public/`; do not submit credentials.
  - Run only unauthenticated/public smoke checks against preview. Full authenticated behavior remains covered by the deterministic local fake-Auth tests; do not create or use a real account for this task.
  - Confirm unauthenticated `/app` leaves the private shell hidden and reaches auth or actionable recovery, and missing-resource simulation remains recoverable where the browser tooling permits it.
  - Record preview URL, asset fingerprints, test summary and reviewer approval without tokens, Firebase user data or raw errors.
  - If preview differs from local assets or any check fails, do not publish production; correct locally and return to Task 1 or 2 if the bug/preservation model changes.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 6. Publish production and perform public post-release checks (manual approval gate)
  - **STOP FOR A SECOND EXPLICIT APPROVAL** after preview evidence is reviewed. Production publication is high risk and must remain a human-authorized action.
  - Capture the current Hosting release identifier/time from the Firebase Hosting release history for rollback; do not inspect Auth users or Firestore documents.
  - After approval, publish only Hosting with `firebase deploy --only hosting --project plannerduo`. Do not commit, push or deploy any other Firebase service as part of this task.
  - Fetch the public static assets `/bootstrap.js`, `/auth`, `/app` and `/app.js`; verify their fingerprints match the approved preview/local release and that Hosting returns the configured no-cache policy.
  - Run public and unauthenticated checks only; never enter real credentials or query cloud data. Confirm `/app` does not reveal the private shell to an unauthenticated session and does not remain indefinitely busy.
  - Observe only sanitized bootstrap diagnostics/aggregate support reports during the agreed monitoring window. Never capture raw error objects, identity fields, tokens or document data.
  - If false recovery increases or static assets do not match, use Firebase Hosting release history to roll back to the captured prior release, then return to the exploration task with the sanitized failing scenario.
  - Record publication result, asset fingerprints, validation time and rollback decision. The bugfix workflow is complete only after this evidence is reviewed.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

## Notes

### Task Dependency Summary

- Task 1 must fail on unfixed code before Task 3 begins.
- Task 2 must pass on unfixed code before Task 3 begins.
- Tasks 3.2 and 3.3 re-run the exact tests from Tasks 1 and 2.
- Task 4 must pass before any publication request.
- Task 5 requires explicit preview approval; Task 6 requires separate explicit production approval.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3"] },
    { "id": 3, "tasks": ["4"] },
    { "id": 4, "tasks": ["5"] },
    { "id": 5, "tasks": ["6"] }
  ],
  "dependencies": {
    "1": [],
    "2": [],
    "3.1": ["1", "2"],
    "3.2": ["3.1"],
    "3.3": ["3.1"],
    "4": ["3.2", "3.3"],
    "5": ["4"],
    "6": ["5"]
  }
}
```
