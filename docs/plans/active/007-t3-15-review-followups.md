# 007: T3-15 review follow-ups

## Goal / Done when

Record the T3-15 fresh-context review's medium finding (fixed) and its low findings so the owner and later tasks see them (T3-15).

- [x] Medium, fixed in commit 0ed8a3e7: a failed e2e build (`scripts/tv-build.mjs`, the probe task failing after `:app:assembleRelease`, other than one probe APK, or no bundle found) removes `app-release.apk`, so the release path never holds a harness build; `scripts/tv-build-cleanup.test.ts` covers each exit
- [x] Lows below logged as follow-ups, not fixed
- [ ] CI gate: the `tv` job's `pnpm tv:apk:check` and `pnpm tv:e2e` steps green on the PR head; the PR quotes the `tv apk:` lines, the two `tv e2e:` lines and `release-evidence/tv/e2e-cleartext.txt`
- [ ] T3-15 set to done with evidence naming the PR

## Context and domains touched

Security & Redaction (the Android network security configuration) and Process (`scripts/`). The spec at `docs/specs/T3-15.md` holds the rules, the milestones and the Implementation record.

## Dependencies

None added.

## Milestones

1. **Review record.** Fix the medium finding with a test; log the lows here. Validation: `mise exec -- pnpm check`. Model: opus.
2. **Ship.** Open the PR, record the `tv` job's `pnpm tv:apk:check` and `pnpm tv:e2e` steps green on the head commit, set T3-15 to done with evidence naming the PR. Model: sonnet.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-21: T3-15 stays `in_progress` until the `tv` job is green on the PR head; local runs do not set `passes`.
- 2026-11-21: The medium fix removes the release APK on every e2e failure (a wrapper around the build), not only on the two exits the review named, because the no-bundle exit leaves the same file behind.

## Surprises & discoveries

Follow-ups (low, not fixed in T3-15):

- scripts/tv-cleartext.test.ts:253-263 (frozen, item 1, partial): the frozen tests feed `judgeNetworkSecurity` hand-made facts and check the two scripts' source structure; that the scripts use the judge is checked only by a regex for the call. `readNetworkSecurity`, the aapt2 parsers and both scripts' exit paths are outside the freeze (the unfrozen `scripts/tv-cleartext-parse.test.ts` covers the parsers on recorded fixtures). If `tv-e2e.mjs` called `judgeNetworkSecurity(...)` and ignored the result, or `main` in `tv-apk-check.mjs` forgot to exit 1, every frozen test would still pass. The real read of the APK rests on the CI `tv` job. Fix: an unfrozen test that runs both scripts' exit paths against the recorded fixtures through a fake `aapt2`.
- scripts/tv-cleartext.test.ts:281-434 (frozen, item 2): the judge is covered thoroughly, but nothing frozen covers the device half (the Kotlin probe and `parseInstrumentation`). A probe that counted `public-refused` wrongly would be caught only in review; the reviewer read CleartextProbe.kt:222-248 and it counts correctly (only `HttpRefusal.PUBLIC_HTTP` counts as refused). The emulator red and green runs are the implementer's evidence. Fix: a JVM test of the probe's counting.
- scripts/tv-cleartext.test.ts:438-487 (frozen, item 3): the tests check the configuration file's shape only (no trust-anchors, pin-set, domain-config or extra attributes). No device run shows HTTPS behaves the same; the probe's `https-open=ok` sends nothing. A changed platform default for `base-config` on a future Android would go unseen. The spec defers a real HTTPS request to T3-05; the PR lists "HTTPS on the device" as untested until then.
- scripts/tv-e2e.mjs:137: when an APK path is passed, the script skips `e2eApkIsCurrent()` and falls back to the default `PROBE_APK` without checking its stamp. A developer who changes the probe or the module's manifest or XML, rebuilds only the e2e APK and passes it explicitly runs the old probe, and the cleartext result describes old sources. Fix: check the stamp when the probe APK is the default one, or require the probe path with an explicit APK.
- scripts/tv-build.mjs:21 and apps/tv/plugins/with-device-probe.js:58-63: the plugin builds `assembleDebugAndroidTest` for every module under `modules/` with `src/androidTest`, but tv-build collects only from the hard-coded `modules/session` output dir and tv-e2e runs only `CleartextProbe`. A later module's probe (for example `modules/player`) would be built and never installed or run while the e2e run stays green. Fix: collect and run every module's probe APK, or build only `modules/session`'s.
- scripts/tv-build.mjs:45: `isE2eInput` leaves out any `modules/` path with a segment named exactly `build`, not only the Gradle output dir. A Kotlin package or resource folder named `build` could change without changing the e2e stamp, so `pnpm tv:e2e` runs a stale probe and e2e APK. Fix: exclude only `modules/<m>/android/build/`.
- ARCHITECTURE.md:251: the I5 row this diff edits still ends with "Native next: T3-04 (build check)", but T3-04 is done (`task.mjs show T3-04`, passes true). Fix: drop or update the clause.

## Validation evidence

Milestone 1, 2026-11-21: see the spec's Implementation record, "Review record".

## Outcome & retrospective

Open.
