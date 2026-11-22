# 005: T3-04 review follow-ups

## Goal / Done when

Record the T3-04 fresh-context review's high and medium fixes and its low findings so the owner and later tasks see them (T3-04).

- [x] High, K5: `java.net.URL` behind an import alias, and a URL opened inside the standard library (`readText()`), fail in source and by type (`scripts/check-network-paths-review.test.ts`, `NetworkPathsReviewTest`)
- [x] Medium, templates: the code of a Kotlin `${...}` template is read as code, in the source check and the inventory
- [x] Medium, ESLint: React Native's and Expo's networking modules, `self`, aliases of globalThis and Image, and the native modules by name are refused in every app file (`scripts/network-lint-review.test.ts`)
- [x] Medium, players and loaders: K4 names `MediaPlayer`, `VideoView`, Coil, Glide and Picasso; the inventory follows a workspace package's dependencies
- [x] Lows below logged as follow-ups, not fixed
- [x] T3-04 set to done with evidence naming the commit or PR (commit b6d16d12)
- [x] `pnpm check` and `pnpm tv:native:test` are green

## Context and domains touched

Security & Redaction (the network fences) and Process (`scripts/`). The spec at `docs/specs/T3-04.md` holds the rules, the milestones and the "Review fixes" record.

## Dependencies

None added.

## Milestones

1. **Review fixes.** The high and three medium fixes with a test each, the lows logged. Validation: `mise exec -- pnpm check`, `mise exec -- pnpm tv:native:test`, `node scripts/check-red.mjs T3-04 --expect green`. Model: opus.
2. **Ship.** PR with the spec's Implementation record as its body. Model: sonnet.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-21: Players and image loaders go under K4 ("another HTTP stack"), because the frozen item 4 test pins the rule ids to exactly K1 to K10.
- 2026-11-21: `URL` is refused as a whole name in Octave's source only; the inventory's shared list keeps `URL(`, because many linked files name the type without opening anything.
- 2026-11-21: Image's network calls and the sending globals are refused on any object, not only on `Image` and the global objects; no app file uses those member names today (`pnpm lint` green).

## Surprises & discoveries

Follow-ups (low, not fixed in T3-04):

- scripts/check-network-paths.mjs (`scanKotlin`, the `oneClient` exemption and the OctaveHttp.kt builder count) and NetworkPathRules.kt (`ONE_CLIENT_CLASSES`): OctaveHttp.kt is exempt from the client-construction name, and only a second `.Builder(` is counted. In OctaveHttp.kt, `val other = OkHttpClient()` passes the source check and the JVM test (only the frozen T3-03 `OneClientTest` substring check catches it), and `val make = ::OkHttpClient; val other = make()` passes every check. The newBuilder match misses `client?.newBuilder()` and a `.newBuilder()` on the next line, because the scan reads one line at a time. Fix: inside OctaveHttp.kt, count every `OkHttpClient(`, `::OkHttpClient` and `Builder(` toward the limit of one, and allow `?.` and line breaks in the newBuilder match.
- apps/tv/native/app/src/test/java/dev/octave/buildcheck/NetworkPathRules.kt (K10 owner check) and NetworkPathsBytecodeTest.kt (`octaveClasses`): the bytecode test reads only classes under `dev/octave/`, and the mangled `internal` rule checks only owners under `dev/octave/session/`. A later module outside `dev/octave/` (an Expo-style `expo.modules.octave...`) is never read, and a mangled `internal` read from another future module (modules/player) is not flagged. Fix: read classes by module rather than by package, and treat a `$<module>_` suffix on any Octave-owned class as mangled.
- scripts/linked-network-paths.mjs and scripts/check-network-paths.mjs (`judgeLinkedClients`): the allowlist works per file, and each entry's reason ("opens no connection", "development tooling") is never checked again. A dependency bump that adds `openConnection()` to DevSupportManagerBase.kt (R6), URLTypConverter.kt (E8) or OkHttpFileUrlInterceptor.kt (E1) passes, because the file already matches. The review checked today's reasons against the installed sources and they hold. Fix: record the matched forms, or their count, for each entry and fail when they change. Related: `walk()` skips any folder named `build` at any depth, and React Native already has an empty `com/facebook/react/common/build` package, so a later source file there would be skipped without notice.
- scripts/check-network-paths.mjs (`readOctaveSource`): the config-plugin scan reads only `apps/tv/plugins/**/*.js`. An inline `withMainApplication` mod in apps/tv/app.config.ts, or a plugin written as `.ts`, `.cjs` or `.mjs`, can write `OkHttpClient()` or `HttpURLConnection` into the generated Kotlin unread; only the JVM test catches it, and only for names it resolves in MainApplication. Fix: scan app.config.* and every plugin extension.
- scripts/network-lint.test.ts:60-80 and scripts/linked-network-paths.test.ts:288-297 (frozen): no frozen sample puts a header or token on a video component (`<Video source={{ uri, headers }} />`); it passes only because the `uri` and `headers` keys are refused everywhere. The frozen R1 and R2 tests check only the global `fetch`, `XMLHttpRequest` and `WebSocket`; the module-path forms are now covered by `scripts/network-lint-review.test.ts`, outside the frozen item. No frozen file changed after the freeze commit b11d34e7.
- Medium finding, part not fixed: a Gradle dependency a module adds in `modules/*/android/build.gradle` (Coil, Glide, Cronet, Media3's RTMP or Cronet data source) is never read by the inventory. The K rules refuse the names in Octave's own source, so the library is reachable only if a module's code names it, but a library that starts its own work at init would not be seen. Fix: read each module's Gradle dependencies against a deny list of group ids.
- eslint.config.js (T1): a destructured global, `const { fetch } = globalThis`, matches no T1 selector; the alias forms `g.fetch` and `self.fetch` are refused. Fix: refuse an `ObjectPattern` property named `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource` whose initializer is `globalThis`, `global`, `window` or `self` (found in the closing check, not by the review).

## Validation evidence

Milestone 1, 2026-11-21: see the spec's Implementation record, "Review fixes".

## Outcome & retrospective

Open.
