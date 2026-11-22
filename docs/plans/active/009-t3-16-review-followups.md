# 009: T3-16 review follow-ups

## Goal / Done when

Fix the T3-16 fresh-context review's medium finding and record its low findings so the owner and later tasks see them (T3-16).

- [x] Medium fixed: C2 runs P4 and P5 on the encoded path of every session and closing call, so a caller of `OctaveHttp.callFactory(session)` cannot send `..%2f`, `..%5c` or `%252e%252e` under the base path (`BasePathDotSegmentTest.kt`, red on the old code)
- [x] Lows below logged as follow-ups, not fixed
- [x] Second review, medium 1 fixed: `pnpm lint:logs` fails the `console`, regex-literal, template and `Timber` forms the review found (`scripts/check-session-logs-bypass.test.ts`, 6 of 8 cases red on the old script), so `docs/security.md`'s Tested row for the log check holds for them
- [x] Regression gate: `pnpm tv:wire --task T3-05` all `pass` on an emulator of the agent's own, or the `wire` job green on the PR head (`docs/specs/T3-16.md`, validation; the native `request` changed) (local run at 342fd255: 8 pairs pass; the second review still wants the `wire` job green on the PR head before done)
- [ ] CI gate: the `tv` job green on the PR head, which also shows whether `dexdump` is on its runner image (`tv:apk:check` needs it). Local evidence: `newestBuildTool` takes the newest build-tools version that holds the tool, main's green `tv` job already finds `aapt2` there the same way, and both local build-tools packages (36.0.0, 37.0.0) ship `dexdump`; the runner's copy stays unverified until CI
- [ ] T3-16 set to done with evidence naming the PR

## Context and domains touched

Security & Redaction (the session module's one client). The spec at `docs/specs/T3-16.md` holds the rules; decision 0005's T3-16 amendment and `docs/security.md` hold the claims.

## Dependencies

None added.

## Milestones

1. **Review fix.** C2 runs P4 and P5; docs narrowed to say so; lows logged here. Validation: `mise exec -- pnpm check`, `mise exec -- pnpm tv:native:test`. Model: opus.
1b. **Second review fix.** The log check's bypasses closed; the second review's lows logged here; the wire rerun retried. Validation: as milestone 1, plus `pnpm tv:wire --task T3-05` on an emulator of the agent's own.
2. **Ship.** Open the PR, wait for `wire` and `tv` green on the head commit, then set T3-16 to done with evidence naming the PR. Model: sonnet.

## Progress

- [x] 1
- [x] 1b
- [ ] 2

## Decision log

- 2026-11-22: C2's P4 and P5 apply with an empty base path too: there is no base path to leave, but the forms a proxy may decode are refused the same way, and T3-03's frozen tests send none of them (`pnpm tv:native:test`, 328 tests, 0 failed).
- 2026-11-22: The refusal stays `outside-base-path`; no new `HttpRefusal` code and no new native method or event.
- 2026-11-22: T3-16 stays `in_progress` until the wire rerun passes; the reviewer's hold on the regression gate stands (as 008 held T3-05).

## Surprises & discoveries

- The local wire rerun could not run: `pnpm fixture:setup` found `jellyfin-10-11` already set up on `127.0.0.1:18096` with no password in this worktree's `tests/integration/.credentials`. The containers on the fixed ports belong to Compose project `octave-8b8377b9f2`, whose working directory (the T3-05 worktree) no longer exists. They were not this agent's to stop, so they were left running. Whoever owns them should run `pnpm fixture:down` for that project, or the fixture ports should be per-worktree.

Follow-ups (low, not fixed in T3-16):

- Fixed in milestone 1b (was low here, rated medium by the second review): scripts/check-session-logs.mjs, the TypeScript half of `lint:logs` could be bypassed by `globalThis.console.log(url)`, `console?.log(url)`, `console["log"](url)`, `const { warn } = console`, a regex literal holding a quote, `Timber.tag("x").d(url)` and `kotlin.io.println(url)`. A Kotlin import alias of a log class (`import android.util.Log as L`) stays beyond the patterns; the frozen `AuthorizationValueTest` word list catches it, under `pnpm tv:native:test` only, and `docs/security.md` now says so.
- modules/session/android/src/main/java/dev/octave/session/http/RequestPath.kt (`escapesAreUtf8`, `holdsDotSegment`) and packages/core/src/adapters/request-path.ts:38-48: P5 checks UTF-8 validity on the path as written only; later rounds decode leniently to U+FFFD. So `/Items/%25c0%25ae%25c0%25ae/x` passes, though the fixture's `why` for `/Items/%c0%ae%c0%ae/x` says a lenient decoder may read the overlong form as a dot. Since the review fix, the same per-round limit applies to C2. Needs a backend that decodes twice and accepts overlong UTF-8 (unverified for Jellyfin and Kestrel). Fix: apply the UTF-8 check in each round, or record the limit beside the four-round note.
- tasks/prd.json (T3-16 evidence); docs/specs/T3-16.md validation: the T3-05 wire rerun is required because the native `request` changed, and has not passed (see Surprises). `tv:apk:check` now needs `dexdump` (scripts/tv-apk-inspector.mjs:119); the `tv` CI job installs no build-tools itself (`.github/workflows/ci.yml`, `tv` job) and relies on the runner image's SDK, so its presence is unverified until the first CI run. Held as the two unticked gates above.
- modules/session/android/src/test/java/dev/octave/session/http/EchoedTokenTest.kt:57-66 (frozen item 2): the "filter switched off" control is the tokenless path, not the session path with the strip disabled. With the session half's exact-equality assertion it does fail if `request` skipped `TokenStrip`, so the reviewer accepts it, but no run shows the session assertion failing with the filter off. A gap if the owner reads the item literally.
- modules/session/android/src/test/java/dev/octave/session/http/HeaderVectorControlTest.kt:54-58 (frozen item 3): the three mutation assertions follow from string equality rather than exercising `kotlin_header_matches_the_recorded_vector`, whose file (`MediaBrowserHeaderTest.kt`) is in no freeze manifest. The frozen file's own byte-for-byte assertion at line 52 and the `applied` counts keep the item bound, for Kotlin only; the core's half rests on `authorization-header.test.ts`, not frozen by T3-16.
- modules/session/android/src/test/java/dev/octave/session/http/ResponseCapTest.kt:67-69, 101-104, 114-116 (frozen item 8): (a) the exactly-at-cap case is sent chunked only, so `contentLength() > cap` written as `>=` in the declared-length branch would pass every case and refuse a legitimate answer of exactly the cap; (b) nothing tells "refused before parse" from "parsed then refused", since valid JSON is used. Neither breaks the item today (`SessionTransport.kt`, `readLimited`). Fix in a new test file: a declared-length answer of exactly the cap, and an oversized body that is not JSON.

Second review's lows (2026-11-22, not fixed in T3-16):

- modules/session/android/src/main/java/dev/octave/session/http/RequestPath.kt:34 and packages/core/src/adapters/request-path.ts:30: P4 compares whole segments with `.` and `..` only. `/Items/..;/x`, `/Items/%2e%2e;/x`, `/Items/..%00/x`, `/Items/%ef%bc%8e%ef%bc%8e/x` (fullwidth dots) and five rounds of encoding (`%252525252e`) pass both sides and C2. A reverse proxy that reads `..;` as `..` (Tomcat or Jetty path parameters) or cuts at NUL would let a crafted path leave the base path while `docs/security.md` says it cannot; whether a common proxy in front of Jellyfin or Kestrel does this is unverified. Fix: refuse `;` and a decoded NUL or control character in any decoding round, or scope the doc claim to plain and percent-encoded dot segments.
- RequestPath.kt:31-39 and request-path.ts:38-48: P5's UTF-8 check runs on the path as written only, so `/Items/%25c0%25ae%25c0%25ae/x` passes (already logged above; the second review confirms it). Fix: run the UTF-8 check in every round.
- modules/session/android/src/test/java/dev/octave/session/http/ResponseCapTest.kt (frozen, item 8): besides (a) and (b) above, `a_sign_in_answer_over_1_mib_is_unexpected_and_opens_no_session` checks only the returned map, not that `SessionRegistry` gained no entry, while `docs/security.md` says "opens no session". Fix in an unfrozen test: a declared-length answer of exactly the cap, an oversized body that is not JSON, and a registry count.
- HeaderVectorControlTest.kt:54-58 (frozen, item 3): confirmed by the second review as above. A normalising rewrite of `MediaBrowserHeaderTest` (ignoring quote style or hex case), which no freeze manifest holds, would leave the control green; only line 52's byte-for-byte `assertEquals` binds the Kotlin half.
- EchoedTokenTest.kt:57-66 (frozen, item 2): the second review rules the tokenless filter-off control acceptable (spec-check note 4): removing the `TokenStrip` call from `request` fails the session half's exact-equality assertion. Remaining gap: no recorded red run with the filter off on the session path. Ship: record a one-off mutation run (for example `forms = emptyList()` on the session branch) in the PR.
- scripts/check-session-logs.test.ts:107-111 and scripts/tv-apk-inspector.test.ts:183-196 (frozen): the CLI tests assert only the exit code. If the `process.argv[1]` guard in `check-session-logs.mjs` stopped matching (a symlinked path or another invocation), `main` would never run and the step would pass vacuously in `pnpm check` and CI. The inspector CLI is tested only on a missing APK, so N1 to N4 on a real APK rest on quoted manual runs. Fix in a new test: assert the stdout summary line and its file count.

## Validation evidence

Milestone 1, 2026-11-22, at 717d2062:

- `mise exec -- node scripts/tv-native-test-only.mjs dev.octave.session.http.BasePathDotSegmentTest` on the old `RequestPolicy`: 4 tests, 3 failed; with the fix: 4 tests, 0 failed.
- `mise exec -- pnpm tv:native:test`: tv native: 328 tests, 0 failed, 2 projects.
- `mise exec -- pnpm check`: exit 0; vitest 2641 and 1366 passed.
- `ANDROID_SERIAL=emulator-5590 pnpm tv:wire --task T3-05` on a fresh read-only `fluster_tv` emulator of this agent's own: did not run past `pnpm fixture:setup` (see Surprises).

Re-verify, 2026-11-22, at 47278414 (no code change):

- `mise exec -- pnpm check`: exit 0; vitest 1366 passed (67 files); check-flow tests 60 pass, 0 fail.
- `mise exec -- pnpm tv:native:test`: tv native: 328 tests, 0 failed, 2 projects.
- `mise exec -- node scripts/check-red.mjs T3-16 --expect green`: exit 0; green [4,5,6,7,8], items 1 to 3 `met`, problems [].
- `mise exec -- pnpm lint:flow`: flow ok: 11 commits ahead; frozen T3-16; 0 frozen changes.
- `pnpm tv:wire --task T3-05`: not rerun; `docker ps` still shows Compose project `octave-8b8377b9f2` on 18096, 18097 and 18098. No on-device run this session; `pnpm tv:e2e` not needed (`git diff --stat origin/main...HEAD -- apps/tv` is empty).

Not run: the Shield, any other Android version or AVD, the dogfood Jellyfin and Jellyscale servers, the pinned Jellyfin and Jellyscale fixtures (wire run blocked).

Milestone 1b, 2026-11-22, at 342fd255:

- `mise exec -- pnpm exec vitest run scripts/check-session-logs-bypass.test.ts` on the old `check-session-logs.mjs`: 8 tests, 6 failed (the 2 controls pass); with the fix: 8 passed.
- `mise exec -- pnpm check`: exit 0; vitest 2641 and 1374 passed; `logs: 27 files ... read`; flow ok, 0 frozen changes.
- `mise exec -- pnpm tv:native:test`: tv native: 328 tests, 0 failed, 2 projects.
- `mise exec -- node scripts/check-red.mjs T3-16 --expect green`: green [4,5,6,7,8], problems [].
- `ANDROID_SERIAL=emulator-5590 pnpm tv:wire --task T3-05` on a fresh read-only `fluster_tv` emulator of this agent's own (API 36), after `pnpm samples:generate` (the first try failed at `fixture:setup`: the Jellyscale scan saw 0 items because this worktree had no samples; the orphaned `octave-8b8377b9f2` containers were gone): 8 pairs pass (probe-then-signed-in on mock, Jellyfin 10.11, Jellyfin 12.4 and Jellyscale; redirect, canary, errors, private-LAN-and-proxy on the mock); logcat clean. Fixtures and emulator torn down after.
- `mise exec -- pnpm tv:build && pnpm tv:apk:check`: `tv inspector: ... passes (1 dex, 5487 classes, R8 release with its mapping ...)`, dexdump from local build-tools.

Not run: the Shield, any other Android version or AVD, the dogfood Jellyfin and Jellyscale servers; CI's `tv` and `wire` jobs (no PR yet).

## Outcome & retrospective

Open.
