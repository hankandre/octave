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
- Negative control (mapping cut to 100 lines): the dex check printed its D3 and D6 lines, the other two passed, `ERROR tv e2e: the e2e APK failed scripts/tv-apk-dex.mjs (exit 1); it was not installed; fix it and run pnpm tv:e2e:build`, exit 1, no adb call.
- First `pnpm check` run had five apps/tv jest timeouts (cold cache, machine loaded); rerun alone and the full check passed.
- The `tv` job step duration before/after is a CI measurement, recorded at Ship.
