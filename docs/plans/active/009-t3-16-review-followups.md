# 009: T3-16 review follow-ups

## Goal / Done when

Fix the T3-16 fresh-context review's medium finding and record its low findings so the owner and later tasks see them (T3-16).

- [x] Medium fixed: C2 runs P4 and P5 on the encoded path of every session and closing call, so a caller of `OctaveHttp.callFactory(session)` cannot send `..%2f`, `..%5c` or `%252e%252e` under the base path (`BasePathDotSegmentTest.kt`, red on the old code)
- [x] Lows below logged as follow-ups, not fixed
- [ ] Regression gate: `pnpm tv:wire --task T3-05` all `pass` on an emulator of the agent's own, or the `wire` job green on the PR head (`docs/specs/T3-16.md`, validation; the native `request` changed)
- [ ] CI gate: the `tv` job green on the PR head, which also shows whether `dexdump` is on its runner image (`tv:apk:check` needs it)
- [ ] T3-16 set to done with evidence naming the PR

## Context and domains touched

Security & Redaction (the session module's one client). The spec at `docs/specs/T3-16.md` holds the rules; decision 0005's T3-16 amendment and `docs/security.md` hold the claims.

## Dependencies

None added.

## Milestones

1. **Review fix.** C2 runs P4 and P5; docs narrowed to say so; lows logged here. Validation: `mise exec -- pnpm check`, `mise exec -- pnpm tv:native:test`. Model: opus.
2. **Ship.** Open the PR, wait for `wire` and `tv` green on the head commit, then set T3-16 to done with evidence naming the PR. Model: sonnet.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-22: C2's P4 and P5 apply with an empty base path too: there is no base path to leave, but the forms a proxy may decode are refused the same way, and T3-03's frozen tests send none of them (`pnpm tv:native:test`, 328 tests, 0 failed).
- 2026-11-22: The refusal stays `outside-base-path`; no new `HttpRefusal` code and no new native method or event.
- 2026-11-22: T3-16 stays `in_progress` until the wire rerun passes; the reviewer's hold on the regression gate stands (as 008 held T3-05).

## Surprises & discoveries

- The local wire rerun could not run: `pnpm fixture:setup` found `jellyfin-10-11` already set up on `127.0.0.1:18096` with no password in this worktree's `tests/integration/.credentials`. The containers on the fixed ports belong to Compose project `octave-8b8377b9f2`, whose working directory (the T3-05 worktree) no longer exists. They were not this agent's to stop, so they were left running. Whoever owns them should run `pnpm fixture:down` for that project, or the fixture ports should be per-worktree.

Follow-ups (low, not fixed in T3-16):

- scripts/check-session-logs.mjs:31 and :69; claim at docs/security.md:66: the TypeScript half of `lint:logs` can be bypassed and nothing else catches these forms (`eslint.config.js` has no `no-console` rule; `AuthorizationValueTest` reads only Kotlin and Java). `findLogViolations` returns 0 for `globalThis.console.log(url)` (the lookbehind skips a `console` after a dot), `console["log"](url)`, `const { warn } = console; warn(url)`, and `const re = /"/; console.log(url); // "` (a regex literal's quote is read as a string start). A later `globalThis.console.warn(request.path, query)` in `apps/tv/src/host/transport.ts` keeps `pnpm check` green while the doc says it fails. The Kotlin forms that bypass the regexes (`Logger.getLogger("x").info(url)`, `import android.util.Log as L; L.d(..., url)`) are caught by the frozen `AuthorizationValueTest` word list, but only under `pnpm tv:native:test`, not `pnpm check`.
- modules/session/android/src/main/java/dev/octave/session/http/RequestPath.kt (`escapesAreUtf8`, `holdsDotSegment`) and packages/core/src/adapters/request-path.ts:38-48: P5 checks UTF-8 validity on the path as written only; later rounds decode leniently to U+FFFD. So `/Items/%25c0%25ae%25c0%25ae/x` passes, though the fixture's `why` for `/Items/%c0%ae%c0%ae/x` says a lenient decoder may read the overlong form as a dot. Since the review fix, the same per-round limit applies to C2. Needs a backend that decodes twice and accepts overlong UTF-8 (unverified for Jellyfin and Kestrel). Fix: apply the UTF-8 check in each round, or record the limit beside the four-round note.
- tasks/prd.json (T3-16 evidence); docs/specs/T3-16.md validation: the T3-05 wire rerun is required because the native `request` changed, and has not passed (see Surprises). `tv:apk:check` now needs `dexdump` (scripts/tv-apk-inspector.mjs:119); the `tv` CI job installs no build-tools itself (`.github/workflows/ci.yml`, `tv` job) and relies on the runner image's SDK, so its presence is unverified until the first CI run. Held as the two unticked gates above.
- modules/session/android/src/test/java/dev/octave/session/http/EchoedTokenTest.kt:57-66 (frozen item 2): the "filter switched off" control is the tokenless path, not the session path with the strip disabled. With the session half's exact-equality assertion it does fail if `request` skipped `TokenStrip`, so the reviewer accepts it, but no run shows the session assertion failing with the filter off. A gap if the owner reads the item literally.
- modules/session/android/src/test/java/dev/octave/session/http/HeaderVectorControlTest.kt:54-58 (frozen item 3): the three mutation assertions follow from string equality rather than exercising `kotlin_header_matches_the_recorded_vector`, whose file (`MediaBrowserHeaderTest.kt`) is in no freeze manifest. The frozen file's own byte-for-byte assertion at line 52 and the `applied` counts keep the item bound, for Kotlin only; the core's half rests on `authorization-header.test.ts`, not frozen by T3-16.
- modules/session/android/src/test/java/dev/octave/session/http/ResponseCapTest.kt:67-69, 101-104, 114-116 (frozen item 8): (a) the exactly-at-cap case is sent chunked only, so `contentLength() > cap` written as `>=` in the declared-length branch would pass every case and refuse a legitimate answer of exactly the cap; (b) nothing tells "refused before parse" from "parsed then refused", since valid JSON is used. Neither breaks the item today (`SessionTransport.kt`, `readLimited`). Fix in a new test file: a declared-length answer of exactly the cap, and an oversized body that is not JSON.

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

## Outcome & retrospective

Open.
