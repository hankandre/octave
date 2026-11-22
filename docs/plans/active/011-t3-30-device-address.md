# 011: T3-30 keep a device's address out of the TV scripts' output and count only the watch's own controls

## Goal / Done when

Implement `docs/specs/T3-30.md` (T3-30).

- [x] Item 1: adb's output reaches no console line, thrown error or evidence file with the serial in it (`scripts/tv-adb.mjs`)
- [x] Item 2: `pnpm check` fails a script that starts adb itself (`scripts/check-adb-output.mjs`)
- [x] Item 3: the watch counts a control only while its own controls run, and a failed control fails the run
- [x] Item 4: two smoke runs on one host: the host-wide lock, an owner file, a message that names the other run
- [ ] Item 5: gate ci: the `tv` and `wire` jobs on the PR head (Ship)
- [x] Item 6: `docs/security.md` and `docs/commands.md`

## Context and domains touched

Security & Redaction; Node scripts under `scripts/`, two documents. No Kotlin, no native module.

## Dependencies

None added.

## Milestones

1. `scripts/tv-adb.mjs`, the five callers on it, the check. 2. The control window and the judge. 3. The owner file. 4. The documents. 5. Device runs and Ship.

## Progress

- [x] 1 (commit f5313224)
- [x] 2 control window, judge, runSmoke; item 3 green (commit c84d6d4b)
- [x] 3 the owner file and the two messages; item 4 green (commit 8cf4def8)
- [x] 4 the documents; item 6 green

- [x] 5 review fixes: the watch lets the event loop run before the controls window (a connection during `adb install` is a stray); the check fails `exec`/`execSync` command strings and wrapper programs (`sh`, `env`, ...) in a file that knows adb. Tests: `scripts/tv-dev-server-watch-stray-install.test.ts`, `scripts/check-adb-output-wrappers.test.ts`.
- [ ] 6 Ship: PR, `tv` job (whole dev-server-watch.txt, two `pnpm tv:smoke` pass lines), `wire` job (a `pass` line per pair). If the CI control command exits non-zero though its connection arrived, change the control command, not the judge.

## Follow-ups (low review findings, not fixed here)

- `scripts/check-adb-output.mjs` `SPECIFIER` matches only `"` and `'`: a template-literal specifier (`` import(`node:child_process`) ``, `` require(`node:child_process`) ``) gets no finding in a file that knows adb.
- The re-export rule and the used-as-a-value rule apply only to files that know adb: a helper that does not mention adb and re-exports `spawnSync` lets an adb-knowing script call it unchecked.
- Frozen tests: the item 3 tests make the stray with an awaited socket, so they never exercised the install path (now covered by `tv-dev-server-watch-stray-install.test.ts`); the item 2 synthetic cases miss template-literal specifiers and a re-exporting helper.

## Decisions

- Redaction sits where adb's output is read. The check is a vitest file over `scripts/` and `tests/integration/`.
- The check also fails a child_process function used as a value (an alias), and reads the bare `child_process` specifier.
- The floor of four characters applies to every derived form (the bare host `tv` of `tv:5555` is not replaced).
- Extra unfrozen tests: `scripts/tv-adb-judges.test.ts` (a stand-in value fails each judge; the floor on forms) and `scripts/check-adb-output-extra.test.ts`.

## Observed facts

Observed on the implementer's own emulator (AVD `fluster_tv`, API 36, 2026-11-22), host adb from platform-tools 37.0.3:

- adb's wording for a missing network device: `adb: device '<host>:5555' not found`, exit 1; for a missing emulator: `adb: device 'emulator-5999' not found`, exit 1. `adb connect` to an address nothing answers does not return within 20 s (no exit status).
- The control command `toybox nc -w 2 <host> <port> </dev/null`: exit 0 and one connection seen when the host listener accepts (localhost through `adb reverse`, and 10.0.2.2). Nothing listening: 10.0.2.2 exits 1 with `nc: connect: Connection refused`; localhost without a reverse exits 1 with the same text; localhost through a reverse with no host listener exits 0 (the device-side forwarder accepts first), so the localhost control is counted by the watch's own listener, and its exit status does not show a host connection.
- Node's `Command failed: <file> <arguments>` text no longer matters: `adbRunner` and every Node error object are gone from the adb runner's results.
- The CI image: unverified until the `tv` job runs (Ship).

## Validation evidence

Own emulator (`fluster_tv`, API 36, port 5590, under the device lock, torn down after), 2026-11-22:

- `pnpm check`: exit 0 (root vitest 96 files, 1671 tests; workflow tests 87; typecheck; lint:flow `0 frozen changes`).
- `node scripts/check-red.mjs T3-30 --expect green`: red [], green [1,2,3,4,6], gate item 5 (ci).
- `ANDROID_SERIAL=emulator-5590 pnpm tv:smoke`: `tv focus: tile-0 took focus with no key, and one Right moved it to tile-1` and `tv smoke: the release app opened no connection to the development server port while it started`; `dev-server-watch.txt`: `port 8081: 2 of 2 control connections seen, 0 app connections, 0 connections before the controls (not counted)`.
- A second smoke run started 4 s after the first failed at once with `ERROR tv smoke: another pnpm tv:smoke run on this host (process <pid>) holds port 8081; wait for it to finish: ...`; the first run still passed and the owner file was gone afterwards.
- `ANDROID_SERIAL=emulator-5590 pnpm tv:e2e`: `url 202/202, device-id 13/13, host ok`; `cleartext private-lan ok, loopback ok, public 60/60 refused`; `resolved-address private ok, mixed ok, public refused`.
- `pnpm tv:wire` was not run locally: the three real targets need the fixture servers, which another worktree's agent holds on the fixed ports (project `octave-0b031fb429`), and tearing them down is not this task's to do. The wire logcat path was run on the emulator instead: `startLogKeeper` over `openAdb(...).stream` kept 3589 lines with the start and end markers seen, no line holding the serial, and the serial written into the marker text came back as `[device]`. The CI `wire` job on the PR head is item 5's regression check (Ship).
- Not run: the Shield or any real TV, network adb against a real device, any Android version but the emulator image's, the dogfood servers.

