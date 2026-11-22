# 012: T3-25 review follow-ups

## Goal / Done when

Record the T3-25 fresh-context review's findings, fix its mediums where a local change can, log its lows so the owner, the Product Owner and later tasks see them, and close T3-25 once its CI gate is met (T3-25). The milestones and decision log of the task itself are in `docs/specs/T3-25.md`.

- [x] The first medium fixed: a test raises each error in the answer's read and a scan guards the parse (commit ae04a189)
- [ ] The second medium: item 4's CI gate (the wire job of `ci.yml` on the PR head, every T3-05 pair `pass`), done in the Ship phase
- [x] Lows below logged as follow-ups, not fixed
- [ ] T3-25 set to done with evidence naming the PR or commit

## Context and domains touched

Security & Redaction (the session module's answer path, `SessionTransport.kt`, `TransportCodes.kt`, `JsonDepth.kt`). `docs/security.md` holds the claim row; decision 0005 holds the amendment.

## Dependencies

None added.

## Milestones

1. **Fix the first medium.** `AnswerReadErrorTest.kt` (new, in no manifest). Validation: `node scripts/tv-native-test-only.mjs dev.octave.session.http.AnswerReadErrorTest`, `mise exec -- pnpm check`, `mise exec -- pnpm tv:native:test`. Model: opus.
2. **Log the review's lows.** Model: opus.
3. **Close.** In the Ship phase: open the PR, wait for the wire job, set T3-25 to done with evidence naming the PR. Model: opus.

## Progress

- [x] 1
- [x] 2
- [ ] 3

## Decision log

- 2026-11-22: The first medium is fixed with no hook in main source (the spec's decision log adds none). The read is reached by reflection on `readLimited` with an okio source that raises the error; the parse cannot be made to raise one from bytes once the depth bound exists, so a source scan holds that only `outcome` catches `Throwable` and nothing catches an `Error` type. Both were shown red by a mutation (an `Error` catch in `readLimited`; a `Throwable` catch in `parse`) and restored. This still does not raise an error in the read or the parse through the one client; the Product Owner confirms item 2's evidence in the PR.
- 2026-11-22: The second medium (no PR, so no wire job on the PR head) needs CI and is left to the Ship phase; the task stays `in_progress` until then.
- 2026-11-22: The four lows are logged, not fixed, as the workflow directed.

## Surprises & discoveries

- A literal of a million digits crosses through the one client on the JVM with status 200: the regex in `strictJson` raises no `StackOverflowError` there (spec-check note 2). Android's ICU regex is unverified.
- `SessionTransport.request` checks the caller's own request body with `runCatching { Json.parseToJsonElement(body) }` (`SessionTransport.kt:83`), which also swallows an `Error`. It is not the answer path and a failure there is `refused`, so it is noted here, not changed.

Follow-ups (low, not fixed in T3-25):

- modules/session/android/src/test/java/dev/octave/session/http/AnswerDepthTest.kt:132-143 (frozen): the only very deep case (100 000 levels) is arrays, which overflow inside the library's reader. Objects switch to a heap-based reader at depth 200, so on main a 100 000-deep object would parse and then overflow later in `strictJson`, `TokenStrip.strip` or `toString`, the three stages item 1 names. No frozen case shows a refusal before them for very deep objects; the depth-65 objects case gives partial cover. Fix in a new test file: a 100 000-deep object through the one client is `unexpected-response`.
- modules/session/android/src/main/java/dev/octave/session/http/SessionTransport.kt `outcome` (:209-215, the review's :205-211) and modules/session/android/src/main/java/dev/octave/session/OctaveSessionModule.kt `run` (:39-49, the review's :41-46): the `OutOfMemoryError` mapping can be bypassed. `outcome` catches the error and then allocates `mapOf("error" to ...)`; if the heap is still exhausted (another thread holds the memory), a second `OutOfMemoryError` escapes and `run`'s last guard answers `network`. `docs/security.md` and decision 0005 say unconditionally that such an error resolves `unexpected-response`. For the Product Owner: either preallocate the two result maps so the mapping allocates nothing, or state the limit in both documents.
- docs/security.md:72 (claim cell): "a parser error is never `network`" overstates the code. Only `StackOverflowError` and `OutOfMemoryError` are mapped; any other `Error` raised during the parse (`LinkageError`, `NoClassDefFoundError`, `InternalError`) is still `network`, and `ParserErrorCodeTest.kt:114` (the review's :330) asserts `LinkageError` keeps `network`. The claim should say "a stack overflow or out-of-memory error is never `network`"; `scripts/security-doc-t3-25.test.ts` (frozen) reads that row, so check it before the wording changes.
- tasks/prd.json T3-25 evidence: it cited commit e40bf264 "(not pushed)" while the head was a330adb6, and item 3's gate asks for the `ResponseCapEdgeTest` run on the PR head. a330adb6 touched only `tasks/prd.json`, so the results held (the review's rerun on the head: 3 tests, 0 failed). The closing evidence names the PR and the commit the gates ran on.

## Validation evidence

Milestones 1 and 2, 2026-11-22, at f3bdd5e5 (main source unchanged since e40bf264: `git diff --stat e40bf264..HEAD -- modules/session/android/src/main apps` is empty):

- `mise exec -- pnpm check`: exit 0; vitest 2892 and 1619 passed; workflow tests pass 87, fail 0; flow ok: 10 commits ahead; frozen T3-25; 0 frozen changes.
- `mise exec -- pnpm tv:native:test`: tv native: 682 tests, 0 failed, 2 projects.
- `node scripts/tv-native-test-only.mjs dev.octave.session.http.AnswerReadErrorTest`: 4 tests, 0 failed. With `catch (error: Error) { ByteArray(0) }` added to `readLimited`: 2 failed; with `catch (_: Throwable)` in `parse`: 1 failed; main source restored with `git checkout` each time.
- `node scripts/tv-native-test-only.mjs dev.octave.session.http.ResponseCapEdgeTest`: 3 tests, 0 failed.
- `mise exec -- node scripts/check-red.mjs T3-25 --expect green`: red [], green [1,2,5], problems []; `T3-16`: red [], green [4,5,6,7,8], problems [].
- `mise exec -- pnpm lint:flow`: flow ok: 10 commits ahead; frozen T3-25; 0 frozen changes.

Not rerun: `pnpm tv:wire --task T3-05` (the diff since its run on e40bf264 is a JVM test and documents only); the wire job of `ci.yml` on the PR head (no PR yet). Not run: the Shield, any physical TV, arm64, other Android versions or AVDs, the pinned Jellyscale, Jellyfin 10.11 and 12.4 and the mock in this round, the dogfood servers, Android's ICU regex on the million-digit literal.

## Outcome & retrospective

Open.
