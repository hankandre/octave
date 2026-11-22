# 008: T3-19 review follow-ups

## Goal / Done when

Record the T3-19 fresh-context review's medium finding (fixed) and its low findings so the owner and later tasks see them (T3-19).

- [x] Medium, fixed in commit 76d2b7c2: code R8 attributes only to a merged lambda group's synthesized `invoke()` frame was judged by neither D1 nor D4, and row X6 allowlisted S1 for a group named after R8's choice of lambda. A synthetic-only site is now Octave's code when its group holds any `dev.octave.` frame; outside Octave a sink there is judged by the referenced member's holder and a hook member there fails D4; X6 is gone (W3 covers the `Networking` getter); R8's dispatch cast is not a D4 reference. `scripts/tv-apk-dex-synthetic.test.ts`; decision log 25 (a D2 and D4 scope edit: a library group's client-getter call passes on the getter's holder's row) in `docs/specs/T3-19.md`; `docs/security.md` corrected
- [x] Lows below logged as follow-ups, not fixed
- [ ] CI gate: the `tv` job green on the PR head; the PR quotes the `tv apk dex:` line, `release-evidence/tv/dev-server-watch.txt`, the first-focus transcript and the run id
- [ ] T3-19 set to done with evidence naming the PR

## Context and domains touched

Security & Redaction (the release APK dex check, the development-server watch) and Process (`scripts/`). The spec at `docs/specs/T3-19.md` holds the rules, the milestones, the decision log and the Implementation record.

## Dependencies

None added.

## Milestones

1. **Review record.** Fix the medium finding with tests; log the lows here. Validation: `mise exec -- pnpm check`, `mise exec -- pnpm tv:apk:check` on the release build. Model: opus.
2. **Ship.** Open the PR (decision log 22, a D4 scope edit, and decision log 25, a D2 and D4 scope edit, flagged as security-rule edits open to the owner's veto), record the `tv` job green on the head commit, set T3-19 to done with evidence naming the PR. Model: sonnet.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-22: T3-19 stays `in_progress` until the `tv` job is green on the PR head; local runs do not set `passes`.
- 2026-11-22: The medium fix judges the synthetic-only site rather than failing it outright: failing every such site would fail the real build on R8's own dispatch, and an exception list is refused. Two narrow rules close the reviewer's paths: the group-holds-Octave test (D1, D4) and the hook rule on any synthetic-only site (D4). On the real build (`pg_map_id` `defa2869…`) the first run under the group test failed D4 on `z6.invoke` line 1451, R8's `check-cast` of the captured value to the merged class `rw` (whose originals include Fresco's `OkHttpNetworkFetcher$fetchWithRequest$2`; the case is `DataPersistor`'s lambda), so that cast is not a D4 reference. Sinks are still judged there. A review-stage probe found the exemption also passed a cast in a synthesized class whose own class line is `dev.octave.`, which failed D4 before; it is now limited to groups whose class line is not `dev.octave.` (test in `scripts/tv-apk-dex-synthetic.test.ts`).

## Surprises & discoveries

Still not seen after the medium fix (stated in `docs/security.md`): an Octave method reference to a listed entry point that is not a hook, folded into a lambda group that holds no other `dev.octave.` code. T3-04's source rules (K7, ESLint) remain the fence.

Follow-ups (low, not fixed in T3-19):

- scripts/tv-apk-dex.mjs:128-136: D0 does not compare a dex whose R8 marker lacks `pg-map-id` against the mapping. The loop skips markers with `pgMapId === null`, so a dex with an R8 marker but no `pg-map-id` passes D0 against any `mapping.txt`, including one from another build (for example after `pnpm tv:e2e:build`), against the spec's D0 rule. A stale mapping then attributes instructions to the wrong original classes, and the result can pass. Fix: fail D0 when no R8 marker of a dex carries a `pg-map-id`.
- scripts/tv-dev-server-watch.mjs:54 and :92-93; scripts/tv-first-focus.mjs:108 and :146: the control phase counts any connection to 127.0.0.1:8081 from the moment the listener binds, which covers the whole `adb install` until `runControls()` resolves. If a stray host process or another emulator connects in that window and one device control fails (for example toybox `nc` is missing on a TV image), `controlsSeen` still reaches `controlsExpected`, and `runSmoke` drops `controlFailures` because `missed` is built only when seen < expected. The run then reports "2 of 2 control connections seen" and passes without proving it can see that device's address. Fix: count controls only while `runControls()` runs, or fail whenever a control command fails.
- scripts/tv-dev-server-watch.mjs:81 and :94; scripts/tv-first-focus.mjs:137-139: the watch writes adb's last output line into thrown errors and into `release-evidence/tv/dev-server-watch.txt`, which CI uploads (ci.yml:197) and the PR quotes. Against a real TV over network adb, an adb error such as "device '<LAN address>:5555' not found" puts a home-LAN address into console output and evidence, against the script's own rule that the serial is never printed or written and the rule against committing a local address. Fix: redact the serial from adb output before printing or writing it.
- scripts/tv-apk-dex.mjs:31-61: `readApkDex` reads central-directory offsets without bounds checks. A truncated or damaged APK (an interrupted `pnpm tv:build`, an artifact cut short in transfer) makes `readUInt32LE` / `readUInt16LE` throw a `RangeError` that `main` does not catch, so the command dies with a stack trace instead of an `ERROR tv apk dex:` line telling the user to rebuild. It still exits non-zero, so it fails closed. Fix: catch it in `main` and report it as a D0 error.
- scripts/tv-apk-dex.test.ts:215-276 (frozen): several frozen D0 cases call `expectFail(run)` with no expected text (no R8 marker, no dex, fewer dex files opened than the APK holds, no Octave class, no `okhttp3.OkHttpClient` class line, `dexdump` exiting non-zero). Each passes on any failure, so a regression in that one D0 rule stays green while some other error fires (removing `sr1`, the excerpt's only `dev.octave.` class, could also trip another rule). These tests check their acceptance item only loosely. Fix: unfrozen tests that assert each D0 message.
- package.json:23 (acceptance item 4): the real half of item 4 is unverified until the `tv` CI job runs on the PR head; the frozen item 4 test reads only `package.json` and `ci.yml`. The CI emulator image may lack toybox `nc`, so the watch's control is missed and `pnpm tv:smoke` fails (fails closed; Ship stops and reports). The reviewer's second risk, R8 naming X6's group differently on CI, is gone with the medium fix; a regroup on CI that puts a library sink or listed reference in a group holding `dev.octave.` code would fail closed with no row to fix it, and Ship stops and reports that too. If R8 names a merged group after an Octave lambda, its dispatch cast to a listed type fails D4 closed, and Ship stops and reports. Before merge, confirm the `tv` job is green on the head and quote its `tv apk dex:` line.
