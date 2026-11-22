# 013: T3-29 review follow-ups

## Goal / Done when

Record the T3-29 fresh-context review's medium finding (fixed) and its low findings so the owner, the Product Owner and later tasks see them, and close T3-29 at Ship (T3-29). The task's milestones, approach and decision log are in `docs/specs/T3-29.md`.

- [x] Medium, fixed in "fix(security): exempt only Socket(Proxy) of the Socket constructors in D1 (T3-29)": D1's `oneClientMethods` matched `java.net.Socket.<init>` by name only, so `Socket(String, int, boolean)`, `Socket(InetAddress, int, boolean)` (a datagram socket when the flag is false) and `Socket(SocketImpl)` passed D1 in `DirectSocketFactory`. The `Socket` entry now lists only `(Ljava/net/Proxy;)`; `scripts/tv-apk-dex-socket-overloads.test.ts`; spec decision log 11
- [x] Lows below logged as follow-ups, not fixed
- [ ] CI gate: the `tv` job green on the PR head, and the PR quotes its `tv apk dex:` line (acceptance item 5)
- [ ] T3-29 set to done with evidence naming the PR (Ship phase)

## Context and domains touched

Security & Redaction: the release APK dex check (`scripts/tv-apk-dex*.mjs`), the Octave module package reader (`scripts/octave-module-packages.mjs`, rule D8), and their claims in `docs/security.md`.

## Dependencies

None added.

## Milestones

1. **Review record.** Fix the medium with a test; log the lows here. Validation: `mise exec -- pnpm check`, `check-red --expect green` for T3-29, T3-19 and T3-04, `pnpm tv:apk:check` on the local release build. Model: opus.
2. **Ship.** Open the PR. Its security heading calls out the narrowed D1 exemption (`oneClientMethods` on S4, now with the `Socket(Proxy)` descriptor), D0's marker and damaged-APK rules, rule D8, K4 by type, the `docs/security.md` change and the `ARCHITECTURE.md` I7 row change, as security-rule edits open to the owner's veto. Quote the `tv` job's `tv apk dex:` line. Set T3-29 to done with evidence naming the PR.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-22: T3-29 stays `in_progress` (passes=false) until the `tv` job is green on the PR head: item 5 is a CI gate.
- 2026-11-22: The Socket entry lists only `(Ljava/net/Proxy;)`, the one constructor `DirectSocketFactory` builds (its source and the as-built dump fixture), not `()` as well; a later need widens it with a reason.
- 2026-11-22: The lows are logged, not fixed, as the workflow directed.

## Surprises & discoveries

Follow-ups (low, not fixed in T3-29), grouped by what would close them.

D8's package reader (one fix closes the first three; the fourth is the doc's claim about them):

- scripts/octave-module-packages.mjs:15: the package pattern `[A-Za-z_][\w.]*` stops at the first character that is not ASCII `\w`, so `package dev.octave$x;` (Java) and `package dev.octaveé.lan` (Kotlin) read as `dev.octave` and pass, although neither is under `dev.octave.`; the dex check then judges that module as a library, the gap D8 exists to close. Fix: read the whole qualified name (`[^\s;]+`), require each segment to be `[A-Za-z_][A-Za-z0-9_]*`, and fail on anything else.
- scripts/octave-module-packages.mjs:20: `withoutComments` strips block comments before line comments, so a `/*` inside a `//` line removes everything up to the next `*/`. A good `dev.octave.lan` file whose header says `// see src/*` fails D8 as the default package (a false failure in `pnpm tv:apk:check` and `pnpm tv:native:test`), and `// matches src/*`, `package com.example.lan`, `/* x */` with a raw string holding `package dev.octave.fake` reads as `dev.octave.fake` and passes. Fix: strip comments in one left-to-right pass and take the first `package` token before any declaration, not a multiline `^package` match anywhere.
- scripts/octave-module-packages.mjs:16: a Gradle `namespace` the regex cannot read is skipped silently: `android { namespace "com.example.lan" }` on one line, `namespace("com.example.lan")` and `namespace = libNs` each give `0 namespaces` and pass. A foreign namespace puts the module's R and BuildConfig classes outside `dev.octave.`. Fix: fail closed when a module's build.gradle(.kts) mentions `namespace` but no literal is read, and accept the call and one-line forms.
- docs/security.md:101: "An Octave module in another Java package cannot ship: rule D8 fails it" claims more than D8 does. D8 reads only `modules/*/android/src` and `apps/tv/native`, not the app package `apps/tv/app.config.ts` sets, and the three reader gaps above also let a foreign package pass. Fix: cut the sentence back to what is read, or point to the D8 bullet's Limit.

The dex check:

- scripts/tv-apk-dex.mjs:63: `readApkDex` checks bounds and sizes but never an entry's CRC-32 (central +16). A stored `classes.dex` with flipped bytes of the same length gets through D0; dexdump then rejects the checksum and `main` prints several lines (`dexdump exited N`, `dexdump opened 0 dex files…`, `the dexdump listing holds no class`), none saying to rebuild, where item 2 asks for one line. It still fails closed. Fix: compare `zlib.crc32(data)` with the central CRC and report a mismatch as `damage`. The `docs/security.md` D0 bullet's "every offset and length is checked" also covers only dex entries; non-dex entries are skipped before their local header is read.
- scripts/tv-apk-dex-judge.mjs:169 (now about line 176): when a match has pairs off the list at a site that already found S4, `judgeSink` runs again in full (spec decision log 10), so a library site matched both directly and through the superclass walk counts twice in `N sink references` and in D2's `(and N more like it)`, and the CI evidence line overstates. Fix: on the second pass emit only the D1 member lines for one-client holders and skip the counters and D2.

For the Product Owner (frozen tests that are weak, not wrong; no frozen file changed):

- scripts/tv-apk-dex-t3-29.test.ts:498: frozen item 4 "a root that holds no module source fails closed" asserts only `errors(run).length > 0`, which would pass if D8 never ran and another rule failed on that input; nothing shows the same input passing with a good root. The implementation is right (`packageProblems`' `read no Octave Kotlin or Java source` line). A later unfrozen test should assert the `D8 read no Octave Kotlin or Java source` text.
- scripts/network-paths-jvm-t3-29.test.ts:33: frozen items 3 and 4 are text pins. They pass when a class name appears quoted anywhere in NetworkPathRules.kt (the `K4_SOCKETS_ONE_CLIENT` allow map or a comment included) and the named Kotlin test functions exist; they do not show K4 refuses anything. The behaviour is checked by the unfrozen Kotlin tests in `pnpm tv:native:test`. The spec accepted this; the guardian should confirm the CI `tv` job ran NetworkPathSocketsTest and the two new NetworkPathsBytecodeTest tests.

Ship checklist (no code):

- tasks/prd.json:1319: the T3-29 evidence names a branch hash (`7f55877d` at review, `12c70085` now), which a rebase merge rewrites, the failure this task fixes for T3-19 (spec, "Citations"). At Ship, replace it with the PR number and the CI run's `tv apk dex:` line.
- docs/specs/T3-29.md:46: item 5 (gate: ci) is not met yet. Locally `check-red --expect green` passes for T3-29 (1-4, 6), T3-19 (1-5) and T3-04 (1-7), and no frozen file of T3-19 or T3-04 is in the diff, but the PR is not open, so the CI `tv apk dex:` line and the call-out of the narrowed D1 exemption (items 5 and 6) do not exist yet. Ship must quote both before merge.
