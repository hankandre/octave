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

- [x] 1 (commit "feat(scripts): keep the device serial out of adb output")

## Decisions

- Redaction sits where adb's output is read. The check is a vitest file over `scripts/` and `tests/integration/`.
- The check also fails a child_process function used as a value (an alias), and reads the bare `child_process` specifier.
- The floor of four characters applies to every derived form (the bare host `tv` of `tv:5555` is not replaced).
- Extra unfrozen tests: `scripts/tv-adb-judges.test.ts` (a stand-in value fails each judge; the floor on forms) and `scripts/check-adb-output-extra.test.ts`.

## Observed facts

(Filled in by milestones 2 and 5: adb's wording for a missing network device, the control command's exit status when it cannot connect and when it connects, the CI image.)

## Validation evidence

(Filled in per milestone.)
