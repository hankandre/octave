# 004: T3-03 review follow-ups

## Goal / Done when

Record the T3-03 fresh-context review's medium fixes and low findings so the owner and later tasks see them (T3-03).

- [x] Medium, caller headers: check 2 refuses `Host`, `Forwarded`, `Cookie2` and names starting with `:`, `Proxy-`, `X-Forwarded-`, `X-Emby-` or `X-MediaBrowser-` (`CallerHeaderTest`)
- [x] Medium, React Native's cookie jar: every OkHttp artifact in the APK is 5.5.1 through the OkHttp BOM (`apps/tv/native` `CookieJarLinkTest`); the owner has not ruled on backlog line 164 and may veto
- [x] Medium, item 1's scan: a stricter scan beside the frozen one (`OneClientScanTest`)
- [ ] Medium, item 1's reading: the Product Owner logs the reason for reading item 1 as Octave's own Kotlin and Java, or narrows the item (backlog line 162). Blocks T3-03 `done`
- [x] Lows below logged as follow-ups, not fixed
- [ ] T3-03 set to done with evidence naming the commit or PR
- [x] `pnpm check` and `pnpm tv:native:test` are green

## Context and domains touched

Security & Redaction and Server Connection & Identity (`modules/session`), Distribution (the APK's OkHttp graph). The spec at `docs/specs/T3-03.md` is the task's spec and holds its milestones and decision log.

## Dependencies

`com.squareup.okhttp3:okhttp-bom` 5.5.1 (a platform), which moves React Native's `okhttp-urlconnection` to 5.5.1 and brings `okhttp-java-net-cookiejar` 5.5.1; maintenance rows in the spec's Dependencies.

## Milestones

1. **Review fixes.** The three medium fixes with a test each, the lows logged. Validation: `mise exec -- pnpm check`, `mise exec -- pnpm tv:native:test`, `node scripts/check-red.mjs T3-03 --expect green`, `pnpm tv:build`, `pnpm tv:apk:check`, `pnpm tv:smoke`, `pnpm tv:e2e`. Model: opus.
2. **Ship.** PR with the spec's Implementation record as its body; the `tv` job green on the PR head before auto-merge. Model: sonnet.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-21: A deny list for caller headers, not an allow list; T8-01's Media3 data source sets headers this task cannot enumerate (spec, Decision log).
- 2026-11-21: Align `okhttp-urlconnection` rather than fence React Native's networking; the fence is a larger scope call. The owner may veto.
- 2026-11-21: Keep T3-03 in progress. Item 1's reading has no Product Owner reason in `tasks/product-owner-log.md`.

## Surprises & discoveries

Follow-ups (low, not fixed in T3-03):

- modules/session/android/src/main/java/dev/octave/session/http/SessionRegistry.kt:54: "no public accessor returns the header" holds only for Kotlin callers. Kotlin `internal` is public in bytecode with a mangled name, so Java in another Gradle module (the T8-01 player, the T3-11 image view) can call `SessionRegistry.INSTANCE.entry$octave_session_release(...).getAuthorization().headerValue$octave_session_release()` and get the full header (`MediaBrowserAuthorization.kt:13`); Kotlin can with `@Suppress("INVISIBLE_MEMBER")`, and `OctaveHttp.client` (`OctaveHttp.kt:16`) is reachable the same way. The frozen `AuthorizationValueTest.kt:149` skips every method whose name holds `$`. T3-04's check, or a review rule, should refuse mangled internal calls and `INVISIBLE_MEMBER` suppressions from other modules.
- modules/session/android/src/test/java/dev/octave/session/http/TwoServerRulesTest.kt:311 and HostClassTest.kt:250: the two "B received nothing" assertions for rule 6 (`public-http`) can never fail: B listens on 127.0.0.1 and the refused address is 203.0.113.7. Only the code and the absent session are checked, so an `open` that probed the address before classifying it would still pass. Add, in a new file, a test that opens a public plain-HTTP session through a resolver or socket factory that records any lookup or connect, and asserts none happened.
- The release dex scan covers classes only: after the BOM, no `okhttp3` or `okio` class is referenced and undefined, but changed method signatures (OkHttp 4 to 5, okio 2 to 3) in React Native, Fresco's `imagepipeline-okhttp3` 3.7.0 and Expo were not scanned.

## Validation evidence

Milestone 1, 2026-11-21: see the spec's Implementation record, "Review fixes".

## Outcome & retrospective

Open.
