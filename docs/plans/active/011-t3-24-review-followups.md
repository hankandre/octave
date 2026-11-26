# 011: T3-24 review follow-ups

## Goal / Done when

Record the T3-24 fresh-context review's low findings so the owner, the Product Owner and later tasks see them, and close T3-24 (T3-24). The milestones and decision log of the task itself are in `docs/specs/T3-24.md`.

- [x] The review's medium fixed: no decoding round may hold a `?` or `#` (commit 3c168d4e)
- [x] Lows below logged as follow-ups, not fixed
- [x] T3-24 set to done with evidence naming the commit (commit 3c168d4e)

## Context and domains touched

Security & Redaction (the session module's path rule, `RequestPath.kt`, and the core's mirror, `request-path.ts`). The spec at `docs/specs/T3-24.md` holds the rule as built; `docs/security.md` (line 32 and the rows at 70 and 90) holds the claims.

## Dependencies

None added.

## Milestones

1. **Fix the medium.** Refuse `?` and `#` in every round on both sides and in C2, with `EscapedQueryFragmentPathTest.kt` and `request-path-query-fragment.test.ts`. Validation: `mise exec -- pnpm check`, `mise exec -- pnpm tv:native:test`, `mise exec -- pnpm tv:wire --task T3-05`. Model: opus.
2. **Log the review's lows.** Model: opus.
3. **Close.** Set T3-24 to done with evidence naming the commit. Model: opus.

## Progress

- [x] 1
- [x] 2
- [x] 3

## Decision log

- 2026-11-22: The medium (an escaped `?` or `#` beside a dot segment passed both sides) is fixed by refusing `?` and `#` in every round, not left as a stated limit. It matches P3 and P6, which refuse the same truncate-after-decoding threat in every round. It goes beyond the acceptance text and fails closed; the Product Owner may veto it. OkHttp 5.5.1 keeps `%3f` and `%23` in `encodedPath` (the precondition of `EscapedQueryFragmentPathTest.the_one_client_refuses_...` holds), so C2 needed the check too.
- 2026-11-22: The four lows are logged, not fixed, as the workflow directed.

## Surprises & discoveries

Follow-ups (low, not fixed in T3-24):

- modules/session/android/src/main/java/dev/octave/session/http/RequestPath.kt `holdsDotSegment` (:62) and packages/core/src/adapters/request-path.ts `hasDotSegment` (:43) (the review cited the pre-fix lines 59 and 41): a dot segment with an invisible character inside it passes. `/Items/.%c2%ad./x` (dot, U+00AD SOFT HYPHEN, dot) and `/Items/.%ef%b8%8f./x` (U+FE0F) are accepted. UTS #46 maps U+00AD and the variation selectors to nothing, and the spec uses UTS #46 to justify listing U+3002 and U+FF61, so a proxy that applies that mapping would read `..`. The limits say only that a proxy that folds another character to a dot is unverified; that does not cover a character a proxy deletes. For the Product Owner: either refuse a segment that is dots once the UTS #46 "ignored" characters are removed, or name deleted characters as a limit in `docs/security.md` and both rule comments with a backlog line.
- modules/session/android/src/main/java/dev/octave/session/http/RequestPath.kt `holdsDotSegment` (:62, the review's pre-fix :59; and `hasDotSegment` in `request-path.ts`): a `..` with a trailing space passes (`/Items/..%20/x` is accepted). A Windows or IIS front end that trims trailing spaces and dots from a segment would read `..`. Whether any proxy in front of Jellyfin does this is unverified, so this is for the Product Owner or the backlog, not a defect.
- modules/session/android/src/test/java/dev/octave/session/http/BasePathFormsTest.kt:53-62 (frozen, item 4): the closing half calls `RequestPolicy.checkClosing` directly, not "through the client's call factory" as item 4 reads. If `SessionInterceptor`'s `Closing` branch (`SessionInterceptor.kt:42-43`) stopped calling `checkClosing`, or a closing call reached the client another way, the test would still pass. The spec check accepted this (note 4) because `check` and `checkClosing` share `checkBasePath`. Fix in a new test file: send a closing call through the client the logout uses.
- modules/session/android/src/test/java/dev/octave/session/http/SemicolonAndControlPathTest.kt:67-68 and DotLikeSegmentPathTest.kt:83,87 (frozen): on the Kotlin side the raw C1 controls (`a\u0085b`, `a\u009fb`) and the raw dot-like characters are probably refused by the existing C1 check (OkHttp would re-encode them) before P3 or P4 runs. If P3's U+0080 to U+009F range or the raw-character half of P4 were removed from `RequestPath.kt`, these Kotlin cases would stay green; only the core's `request-path-forms.test.ts` would catch it. The escaped forms (`%c2%85`, `%ef%bc%8e`) do test the rule natively, so item coverage stands. Fix in a new test file: call `RequestPath.isSafe` directly with the raw characters.

## Validation evidence

Milestones 1 to 3, 2026-11-22, at 5483e155:

- `mise exec -- pnpm check`: exit 0; vitest 2892 and 1561 passed; flow ok: 8 commits ahead; frozen T3-24; 0 frozen changes.
- `mise exec -- pnpm tv:native:test`: tv native: 643 tests, 0 failed, 2 projects.
- `node scripts/tv-native-test-only.mjs dev.octave.session.http.EscapedQueryFragmentPathTest`: 33 tests, 0 failed; on the old `RequestPath.kt`: 27 failed (every refusal case).
- `mise exec -- node scripts/check-red.mjs T3-24 --expect green`: green [1,2,3,4,5,6], problems []; `T3-16`: green [4,5,6,7,8], problems [].
- `ANDROID_SERIAL=emulator-5596 mise exec -- pnpm tv:wire --task T3-05` on this agent's own read-only `fluster_tv` emulator (system image android-36 android-tv x86_64, from the AVD's config.ini), stopped after: exit 0; `tv wire: 8 pair(s) passed; logcat clean`.

Not run: the Shield (not touched), `emulator-5580` (another agent's, not touched), any physical TV, arm64, other Android versions or AVDs, a real reverse proxy, the dogfood servers, Hermes's `decodeURIComponent` on device.

## Outcome & retrospective

Open.
