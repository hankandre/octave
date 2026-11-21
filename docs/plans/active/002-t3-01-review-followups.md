# 002: T3-01 review follow-ups

## Goal / Done when

Record the T3-01 fresh-context review's medium fixes and low findings so the owner and later tasks see them (T3-01).

- [x] Medium, item 7: the spec's Dependencies section records the native modules `expo` links into the release APK, why each is acceptable, the fence, and the T3-04 question (`tasks/backlog.jsonl`)
- [ ] Medium, item 2: the ci.yml `tv` job green on the PR head commit, with artifact `octave-tv-release-apk` and its `pnpm tv:apk:check` and `pnpm tv:smoke` steps passing in that run (Ship phase; merge only after it)
- [x] Lows below logged as follow-ups, not fixed
- [ ] T3-01 set to done with evidence naming the green `tv` run
- [x] `pnpm check` is green

## Context and domains touched

Distribution (`apps/tv`), Security & Redaction (invariant I7 and the one-client rule, `ARCHITECTURE.md` §2), `docs/specs/T3-01.md`. The spec at `docs/specs/T3-01.md` is the task's spec.

## Dependencies

None adopted. The item 7 record covers modules `expo` already brings; each passes the maintenance rule through the `expo` row.

## Milestones

1. **Review fixes.** Spec record and backlog question. Validation: `mise exec -- pnpm check`, `node scripts/check-red.mjs T3-01 --expect green`. Model: opus.
2. **Ship.** PR without auto-merge until the `tv` job is green. Validation: `gh run view <run> --json jobs`. Model: sonnet.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-21: Record the expo modules and send the fence to T3-04 instead of adding an ESLint ban now. T3-04 owns the build check (its items 2 and 3); a second, partial fence here would overlap it.
- 2026-11-21: Keep T3-01 in progress. Item 2 has never run in CI, and the `react-refresh` row the item 7 review asked for is logged below, not added.

## Surprises & discoveries

`@expo/log-box` also reaches the network (`ExpoLogBoxSurfaceDelegate.kt:107`, through React Native's provider), and `expo-modules-core` ships network-inspector interceptors (`ExpoNetworkInspectOkHttpInterceptors.kt:24`, `:62`); the review named only fetch, file system and the DOM WebView.

Follow-ups (low, not fixed in T3-01):

- apps/tv/package.json:24, pnpm-lock.yaml:1580-1591: `babel-preset-expo@58.0.26` has a required peer `react-refresh` (`>=0.14.0 <1.0.0`), satisfied with 0.14.2 through `@react-native/babel-preset` 0.88.1. The spec's Dependencies table has no row for it, though it has rows for the analogous auto-installed peers. Add a row with its maintenance check (npm latest 0.19.0, modified 2026-11-19); until then item 7's "every package the install forced in has a row" is not met as written.
- apps/tv/app.config.ts:6-19: the release APK requests `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` and `VIBRATE` from Expo's template (`aapt2 dump badging`); no `android.blockedPermissions` is set. Block them in the config, or have T4-08's `release_build_has_no_inspector` check (backlog line 87, taken by T4-08) refuse `SYSTEM_ALERT_WINDOW` in a release APK. Against `docs/security.md:48`.
- eslint.config.js:31-36: the item 6 platform rule covers only `apps/tv/**/*.{ts,tsx}`. `import { ToastAndroid } from "react-native"` in `apps/tv/src/probe.js` lints clean, yet Metro bundles it. Destructuring a default import (`const { ToastAndroid } = RN;`) also lints clean in a `.ts` file (tsc may reject the default import, unverified). Widen the glob to `js,jsx` and add a `VariableDeclarator` selector before T14's tvOS build.
- apps/tv/src/first-screen/FirstScreen.tsx:63: the focused tile has no 1 px black .6 outer line (`DESIGN.md:196`; the spec drops the lift on purpose but not the line), and `borderColor: "transparent"` is a colour literal in a component. The screen is a placeholder T3-06 and T3-09 replace; the shared card must not copy it.

## Validation evidence

Milestone 1, 2026-11-21, rerun after the expo-modules-core row (docs, plan and backlog only; no code, Kotlin or screen change, so `tv:native:test`, `tv:e2e`, `tv:visual` and the tripwire are not triggered):

- `mise exec -- pnpm check`: exit 0; core `Tests 2570 passed (2570)`, scripts `Tests 515 passed (515)`.
- `node scripts/check-red.mjs T3-01 --expect green`: green [1,3,4,5,6], `"problems":[]`; items 2 (ci) and 7 (review) are gates.
- `pnpm lint:backlog`: `backlog ok`.

## Outcome & retrospective

Open.
