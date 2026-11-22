# 011: T3-30 keep a device's address out of the TV scripts' output and count only the watch's own controls

## Goal / Done when

Implement `docs/specs/T3-30.md` (T3-30).

- [ ] Item 1: adb's output reaches no console line, thrown error or evidence file with the serial in it (`scripts/tv-adb.mjs`)
- [ ] Item 2: `pnpm check` fails a script that starts adb itself (`scripts/check-adb-output.mjs`)
- [ ] Item 3: the watch counts a control only while its own controls run, and a failed control fails the run
- [ ] Item 4: two smoke runs on one host: the host-wide lock, an owner file, a message that names the other run
- [ ] Item 5: gate ci: the `tv` and `wire` jobs on the PR head (Ship)
- [ ] Item 6: `docs/security.md` and `docs/commands.md`

## Context and domains touched

Security & Redaction; Node scripts under `scripts/`, two documents. No Kotlin, no native module.

## Dependencies

None added.

## Milestones

1. `scripts/tv-adb.mjs`, the five callers on it, the check. 2. The control window and the judge. 3. The owner file. 4. The documents. 5. Device runs and Ship.

## Progress

- [x] 1 (commit f5313224)
- [x] 2 control window, judge, runSmoke; item 3 green (commit c84d6d4b)
- [x] 3 the owner file and the two messages; item 4 green

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

(Filled in per milestone.)
