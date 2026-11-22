# 014: T4-09 review follow-ups

## Goal / Done when

Record the T4-09 fresh-context review's findings so the owner and later tasks see them (T4-09).

- [x] The medium finding fixed with a test, as far as a local run can go
- [x] Lows below logged as follow-ups, not fixed
- [ ] T4-09 set to done with evidence naming the PR, after the PR's `tv` job shows the ran-stage line (milestone 7)

## Context and domains touched

Server Connection & Identity (the install id, `modules/install-id`, `apps/tv/src/host/`), the install-id stage of `pnpm tv:e2e` and `docs/security.md` §6. The spec at `docs/specs/T4-09.md` holds the rules and milestones.

## Dependencies

None added.

## Milestones

1. **Fix the medium and log the lows.** Validation: `mise exec -- pnpm check`.
2. **CI proof (Ship).** Read `release-evidence/tv/e2e-install-id.txt` from the PR's `octave-tv-evidence` artifact; it must hold `relaunch=same clear=new restore=new transport=selected backup=refused|success`. Then reword the install-id bullet of `docs/security.md` §6 and `scripts/tv-install-id-security-scope.test.ts` together, and set T4-09 to done naming the PR.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-22: Medium (CI proof missing; §6 marked `clear=new` and `backup=refused` **Tested** from one local run): the install-id bullet now scopes both claims to one run on the implementer's own API 36 emulator and marks the CI image **Planned (T4-09)** until the PR's artifact holds the ran-stage line. T4-09 stays `in_progress` with `passes` false. Test: `scripts/tv-install-id-security-scope.test.ts` (fails on the old wording). The frozen `**Planned (T4-05, T4-09)**` marker (T3-23) is untouched.

## Surprises & discoveries

Follow-ups (low, not fixed in T4-09):

- eslint.config.js:160,165 (claim at docs/security.md:101): the gateway rule misses an ES2022 string-named import (`import { "JellyfinGateway" as G } from ".../jellyfin/gateway"`, where `imported.name` is undefined) and `require()` with a template literal argument (`arguments.0.value` is undefined). Both passed ESLint on `apps/tv/src/probe.ts` in review, while §6's table says a value import "under any local name" and `require()` are failed. Fix: also match `imported.value` and refuse TemplateLiteral arguments (ImportExpression too), or narrow the doc's claim.
- eslint.config.js:156: the module-path regex `(^|/)jellyfin/gateway$` misses `.../jellyfin/gateway.js` and `.../jellyfin/gateway/`; neither was flagged in review. Whether tsc (moduleResolution bundler) and Metro resolve them to `gateway.ts` is unverified. Note the gap in docs/security.md beside the two already stated, or widen the regex to an optional extension or trailing slash.
- scripts/tv-install-id.test.ts:445-456 (frozen): the scan `constructsOrImportsClass` behind "a scan finds none today" reads only `import ... from` and `new JellyfinGateway`; it never sees `require()`, `import()`, `export ... from` or a string-named specifier. A re-export or a destructured `require` with an eslint-disable comment stays green; only ESLint with `reportUnusedDisableDirectives` stands in the way. The scan is a weaker second check than the spec's Test plan implies; any change goes in a new file or with a `Frozen-Test-Change` trailer.
- docs/specs/T4-09.tests.json items 1 and 3; scripts/tv-install-id.test.ts:120-210; scripts/tv-install-id-stage.test.ts:231-330 (frozen): no frozen run exercises the storage behaviour. Item 1's "stores it on the device" is checked only against a fake native `keep()`; item 3's "clearing gives a new id" and the backup outcome only through `judgeInstallId` on synthetic transcripts and text scans. `InstallIdStore.keep` returning the candidate unstored would leave both frozen runs green; only `InstallIdStoreTest` (`pnpm tv:native:test`) and the device stage catch it. The spec accepts this split; reviewers treat the JVM tests and the CI ran-stage line as the real proof for items 1 and 3.
- scripts/tv-install-id-stage.test.ts:265-266 (frozen): the item 3 "no other directory" scan is a deny-list of names; it does not flag `externalFilesDirs`/`getExternalFilesDirs` (the plural fails the `\b` after `Dir`), a literal path such as `File("/data/data/...")`, `context.applicationInfo.dataDir`, or `createDeviceProtectedStorageContext()`. A later write of the id under `File(context.applicationInfo.dataDir, "files")` would stay green while §6 says no other directory is named. Today the Kotlin names only `noBackupFilesDir` (`OctaveInstallIdModule.kt:29`, `InstallIdStore.kt`).
- docs/security.md:205: stale marker from the Product Owner ruling (flagged for the owner's veto, not human-confirmed). After T4-09 merges, §6 still lists "nothing Octave stores leaves the device through a cloud backup or a device-to-device transfer" as **Planned (T4-05, T4-09)** while T4-09 is done and runs no transfer. Only the backlog line (source "T4-09 ruling, Implement") tracks the rename; reported so the owner sees it at the gate, not to reopen the ruling.
- modules/install-id/android/build.gradle:30-33; apps/tv/package.json:12: item 4 review gate passed, not a defect. The only new dependency is the workspace package `@octave/install-id`; `pnpm-lock.yaml` adds only its link and the empty importer; build.gradle has only test dependencies (junit-bom 6.1.3, junit-jupiter, junit-platform-launcher). Guardian scope: the diff adds a native module method (an architecture change under AGENTS.md), Kotlin, and docs/security.md changes; the spec's decision log records it and no file in docs/decisions/ is added.

## Validation evidence

See the task evidence and the commit that adds this plan.
