# 015: T3-31 e2e APK checks

## Goal / Done when

`pnpm tv:e2e` runs the dex, inspector and native inspector checks on the e2e APK, with the R8 mapping of its own build kept beside it, before any adb command (T3-31). Approach and decisions: `docs/specs/T3-31.md`.

- [x] Build keeps the mapping (`E2E_MAPPING`), `e2eApkIsCurrent()` requires it
- [x] `scripts/tv-e2e-apk.mjs` and its call in `scripts/tv-e2e.mjs`
- [x] `docs/security.md`, `docs/commands.md`, backlog line
- [x] Local verify on the emulator
- [ ] CI: `tv` job green on the PR head (Ship phase; evidence outside the manifest)

## Milestones

1. Build. 2. Checks. 3. Documents. 4. Verify.

## Progress

- [x] 1  - [x] 2  - [x] 3  - [x] 4 (CI half at Ship)

## Decision log

- 2026-11-22: Mapping moved, not copied. After `pnpm tv:e2e:build`, `pnpm tv:build` reran R8 (34 tasks executed) and `pnpm tv:apk:check` passed, so Gradle reruns R8 when `mapping.txt` is gone; no copy fallback needed.
- 2026-11-22: The closing line also says `run pnpm tv:e2e:build` (spec-check note 1). `scripts/tv-e2e-apk.mjs` avoids the word `lists` because the frozen item 3 test forbids it.
- 2026-11-22: In the `tv` job the second Gradle run does not rerun R8, so the mapping moved to `E2E_MAPPING` may be the release run's file with the same `pg_map_id`; it is the mapping of the dex in the e2e APK, matched by `pg_map_id`, not a separate R8 run.

## Surprises & discoveries

- Local e2e dex check: 5310 classes, 222 sink references, same as the release APK; no row was needed for the e2e APK (item 3).
- Pass lines of the three checks on the e2e APK, as `pnpm tv:e2e` printed them on an own emulator at `964dc3b7` (mapping `# pg_map_id: a005bc06e5db632695193179114b6dc53836e0053a175d5ba50f1afdf97cdaae`). `pnpm tv:e2e` prints the APK path absolute; the checkout's directory is written here as `<checkout>`, and nothing else is changed:
  - `tv apk dex: <checkout>/apps/tv/dist/e2e/octave-tv-e2e.apk passes (5310 classes in 1 dex files, 222 sink references in 14 listed entry points, 0 in Octave's code outside the one client)`
  - `tv inspector: <checkout>/apps/tv/dist/e2e/octave-tv-e2e.apk passes (1 dex, 5310 classes, R8 release with its mapping; no class of expo.modules.kotlin.devtools, expo.modules.devlauncher, expo.modules.devmenu, expo.modules.networkaddons kept or renamed)`
  - `tv native inspector: <checkout>/apps/tv/dist/e2e/octave-tv-e2e.apk passes (44 libraries in 2 ABIs; libreactnative.so defines the C++ inspector's network dispatcher in each and nothing calls it; no debugger-only string)`
  - The same run then printed `tv e2e: url 202/202, device-id 13/13, host ok`, `tv e2e: cleartext private-lan ok, loopback ok, public 60/60 refused` and `tv e2e: resolved-address private ok, mixed ok, public refused`, exit 0. `node scripts/tv-apk-dex.mjs`, `tv-apk-inspector.mjs` and `tv-apk-native-inspector.mjs`, given the e2e APK and mapping as relative paths, print the same three lines with the relative path.
- Negative control (mapping cut to 100 lines, dex check on the built e2e APK, 45 `ERROR` lines; the first and last, and one D3 line):
  - `ERROR tv apk dex: D2 unresolved:a5.c holds S6 (another platform HTTP stack, player URL, download manager or network-bound socket) at a5.c line 2, and no APK_NETWORK_ENTRY_POINTS row covers it; add a row with its reason, or remove the dependency (and 2 more like it)`
  - `ERROR tv apk dex: D3 row N1 names com.facebook.react.modules.network.NetworkingModule, which holds none of S1 in the APK; remove it from the row, or correct the row`
  - `ERROR tv apk dex: D6 DevSupportHttpClient is not in the APK, so DEV_SUPPORT_CLIENT_CALLERS must be empty`
  - Under `pnpm tv:e2e` the other two checks passed, the run closed with `ERROR tv e2e: the e2e APK failed scripts/tv-apk-dex.mjs (exit 1); it was not installed; fix it and run pnpm tv:e2e:build`, exit 1, no adb call.
- First `pnpm check` run had five apps/tv jest timeouts (cold cache, machine loaded); rerun alone and the full check passed.
- The `tv` job step duration before/after is a CI measurement, recorded at Ship.
