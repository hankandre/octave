# Commands

Every command an agent or contributor runs in Octave. `AGENTS.md` holds the rules; this file holds the how.

- Use the Node version in `.node-version` (mise reads it via `mise.toml`; run `mise exec --` in non-interactive shells).
- Install: `pnpm install`
- Core unit tests (Vitest, Node environment): `pnpm --filter @octave/core test`; `pnpm test` runs them, then the root scripts and workflow tests
- Type-check: `pnpm typecheck`
- Lint: `pnpm lint`, `pnpm lint:boundaries`, `pnpm lint:network` (T3-04: no network path around the one client), `pnpm lint:ghost-terms`, `pnpm lint:backlog`, `pnpm lint:flow`
- Task workflow tests: `pnpm test:workflow`
- All checks: `pnpm check`
- Server tripwire (needs `pnpm samples:generate`, `pnpm fixture:up`, `pnpm fixture:setup`): `pnpm test:tripwire`
- Jellyscale fixture check (needs the fixture servers up and set up): `pnpm fixture:check-jellyscale` re-probes the pinned Jellyscale and fails if its endpoint inventory changed.
- Task CLI: `pnpm task next`, `pnpm task show <id>`, `pnpm task list [--status s] [--phase p]`, `pnpm task set <id> --status s [--owner o] [--evidence-file f]`.
- TV app (needs the Android SDK in `ANDROID_HOME` and the JDK `mise.toml` names): `pnpm tv:prebuild` (generate `apps/tv/android`), `pnpm tv:build` (release APK), `pnpm tv:apk:check` (its badging, permissions, queries and backup setting; takes no argument), `pnpm tv:native:test` (the app's and modules' JVM tests), `ANDROID_SERIAL=<your own emulator> pnpm tv:smoke` (first focus on an Android TV emulator), `pnpm tv:e2e:build` (the e2e APK), and `ANDROID_SERIAL=<your own emulator> pnpm tv:e2e` (the core's conformance suites under Hermes on the emulator; builds the e2e APK when it is missing or stale)
- Not yet built: `pnpm tv:wire` (T3-05), `pnpm tv:visual` (T3-07).

## Native tests

- `pnpm tv:native:test` runs the app's and the native modules' JVM tests; `node scripts/tv-native-test-only.mjs <filter>` runs one class.
