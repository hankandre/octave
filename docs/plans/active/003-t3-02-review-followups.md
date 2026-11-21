# 003: T3-02 review follow-ups

## Goal / Done when

Record the T3-02 fresh-context review's medium fix and low findings so the owner and later tasks see them (T3-02).

- [x] Medium, item 4 wording: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `tasks/backlog.jsonl` and the spec no longer say `tv` is required before ruleset 26769544 lists it
- [ ] Medium, item 4 gate (a): the ci.yml `tv` job green on the PR head commit, its `pnpm tv:e2e` step passing, and `release-evidence/tv/e2e-conformance.txt` in `octave-tv-evidence` showing `url total=202 passed=202`, a device-id line with passed equal to total, and `host url=expo-builtin engine=hermes` (Ship phase)
- [ ] Medium, item 4 gate (b): `gh api repos/{owner}/{repo}/rulesets/26769544 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'` lists `tv` (owner action; no agent edits the ruleset)
- [x] Lows below logged as follow-ups, not fixed
- [ ] T3-02 set to done with evidence naming the green `tv` run and the ruleset read
- [x] `pnpm check` is green

## Context and domains touched

Process and CI (`.github/workflows/ci.yml`, `.github/dependabot.yml`, ruleset 26769544), Distribution (`apps/tv`), the core's host ports (`ARCHITECTURE.md` §2). The spec at `docs/specs/T3-02.md` is the task's spec.

## Dependencies

None adopted.

## Milestones

1. **Review fixes.** Reword the present-tense "tv is required" claims; log the lows. Validation: `mise exec -- pnpm check`, `node scripts/check-red.mjs T3-02 --expect green`. Model: opus.
2. **Ship.** PR; the owner adds `tv` to the ruleset once the job is green, before the merge ("Making `tv` required" in the spec). Validation: `gh run view <run> --json jobs` and the ruleset read. Model: sonnet.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-21: Reword, do not test, the item 4 claims. They are comments and a backlog line with no behaviour; a test asserting "tv is not required" would break the moment the owner acts. The ruleset read is the source of truth.
- 2026-11-21: Align the spec's own instruction ("it is a required check from this task on", `docs/specs/T3-02.md`, CI section) with the fix; it is not marked as confirmed by the human.
- 2026-11-21: Keep T3-02 in progress. Item 4 has never run on a PR head and the ruleset does not list `tv` yet.

## Surprises & discoveries

Follow-ups (low, not fixed in T3-02):

- eslint.config.js:48, eslint.config.js:73; scripts/tv-host.test.ts item-1 lint cases: dependency rule 4's fence for `expo-crypto` catches only static `import` and `export`. ESLint on stdin as `apps/tv/src/probe.ts`: `const C = require("expo-crypto")` exits 0, `import("expo-crypto")` exits 0; only `export * from "expo-crypto"` is refused. T3-01's `no-restricted-syntax` closes `require()` destructuring for its own modules (eslint.config.js:54), but nothing like it covers `expo-crypto`. A later screen could build its own crypto outside the composition root with `pnpm check` green. The frozen item-1 test tries only static forms. Add `require` and `ImportExpression` selectors for `expo-crypto` outside `apps/tv/src/host/`, with tests in a new file.
- scripts/tv-host.test.ts (item 1), apps/tv/src/host/crypto.ts:4: no test or device check shows that `hostCrypto` comes from `expo-crypto` ("from Expo's implementations"). Swapping in a pure-JS SHA-256 and `Math.random` UUIDs would pass items 1-3 and the device run. The adapter is correct today. Add a static assertion that `crypto.ts` imports `digestStringAsync` and `randomUUID` from `expo-crypto`.
- scripts/tv-build.mjs:36 (`isE2eInput`): `e2eSourceHash` leaves out `packages/core/package.json` and tsconfig, the root `package.json`, `pnpm-workspace.yaml`, any pnpm patches directory, and `scripts/tv-build.mjs` itself. Editing one of them and running `pnpm tv:e2e` locally reuses a stale e2e APK. CI is unaffected (it always runs `tv:e2e:build` first); this weakens the local verify line eight later tasks share.
- Design review (apps/tv/src/first-screen/FirstScreen.tsx:7, apps/tv/src/e2e/root.tsx:25): no findings. FirstScreen changes only its import path; the e2e root is an empty `View` in the e2e bundle only. `pnpm tv:visual` (T3-07) does not exist yet.

## Validation evidence

Milestone 1, 2026-11-21 (comments, docs, plan and backlog only; no app, Kotlin or screen change, so `tv:e2e`, `tv:native:test`, `tv:visual` and the tripwire are not triggered):

- `mise exec -- pnpm check`: exit 0; core `Tests 2583 passed (2583)`, scripts `Tests 616 passed (616)`, flow `pass 60 fail 0`.
- `node scripts/check-red.mjs T3-02 --expect green`: green [1,2,3], `"problems":[]`; item 4 is a `ci` gate.
- `pnpm lint:backlog`: `backlog ok`.

Re-verification, 2026-11-21 (head 93e6b5a4, no code change):

- `mise exec -- pnpm check`: exit 0; core `Tests 2583 passed (2583)`, scripts `Tests 616 passed (616)`, flow `pass 60 fail 0`.
- `node scripts/check-red.mjs T3-02 --expect green`: green [1,2,3], `"problems":[]`.
- `ANDROID_SERIAL=emulator-5560 pnpm tv:e2e` (own `fluster_tv` emulator, API 36): exit 0; `tv e2e: url 202/202, device-id 13/13, host ok`; `host url=expo-builtin engine=hermes`.
- `gh pr list --head task/T3-02 --state all`: `[]`; the ruleset read lists `checks`, `dependency-review`, `tripwire` and no `tv`. Item 4 stays pending for the Ship phase.
- Not tested: the Shield (Android 11), other emulator images and Android versions, tvOS, any Jellyfin or Jellyscale server (the task sends no request).

## Outcome & retrospective

Open.
