# 008: T3-05 review follow-ups

## Goal / Done when

Record the T3-05 fresh-context review's medium finding (a CI gate, held open) and its low findings so the owner and later tasks see them (T3-05).

- [x] Medium, held: item 7's `gate: ci` is not met until the branch is pushed. T3-05 stays `in_progress`; the task evidence now quotes the whole local `release-evidence/wire/summary.txt` (eight `pass` lines, no `fail` line, written after the last code commit 39b5ca31), not one line of it
- [x] Lows below logged as follow-ups, not fixed
- [ ] CI gate: the PR is opened as a draft with no auto-merge until the non-required `wire` job is green on the head commit; its `summary.txt` holds all eight `pass` lines, including `transport-probe-then-signed-in jellyscale T3-05 pass`, and no `fail` line, and is quoted in the task evidence (item 7)
- [ ] CI gate: the required `tripwire` job green on the PR head, with the `octave-<hex>` Compose project name in its `fixture:up` output (item 8's Docker half)
- [ ] CI gate: the `tv` job green on the PR head
- [ ] T3-05 set to done with evidence naming the PR
- [ ] PR body calls out `apps/tv/babel.config.js` as a release-path build change (see the last low below)

## Context and domains touched

Server Connection & Identity (the Transport port), Security & Redaction (the session module, the wire evidence) and Process (`scripts/`, CI). The spec at `docs/specs/T3-05.md` holds the rules, the milestones and the Implementation record.

## Dependencies

None added.

## Milestones

1. **Review record.** Log the medium gate and the lows here; refresh the task evidence. Validation: `mise exec -- pnpm check`. Model: opus.
2. **Ship.** Open the PR as a draft, wait for `wire`, `tripwire` and `tv` green on the head commit, quote the CI `summary.txt` in the evidence, then mark ready and set T3-05 to done with evidence naming the PR. Model: sonnet.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-22: T3-05 stays `in_progress` until the `wire` job is green on the PR head; the local run does not set `passes` (spec, spec-check note 4).
- 2026-11-22: The medium finding needs no code change: it is a gate that only CI can close. No test is added for it, because no behaviour changed.

## Surprises & discoveries

Follow-ups (low, not fixed in T3-05):

- scripts/tv-wire.mjs:209, with the `fail()` exits at 67-70 and 117-147: every early exit (no device, a failed adb install, a failed APK build, a failed `adb reverse`, a missing fixture credential) happens before `rmSync(EVIDENCE)` at 229. An all-pass `release-evidence/wire/summary.txt` from an earlier run survives a later failed run and can be quoted as the current code's result. CI is unaffected (fresh checkout). Fix: remove the evidence directory at the start of the run, before any exit.
- scripts/tv-wire-proxy.mjs:316-317, scripts/tv-wire.mjs:240 and `.github/workflows/ci.yml` (Upload the wire evidence): the recorder stores `url.pathname` and the raw query names, and the runner writes them to `release-evidence/wire/<pair>.jsonl` even when `secretInUrl` is true; the `wire` job uploads that directory with `if: always()`. A regression that puts the token in a path segment or a query name fails the judge (whose messages hide the value) but leaks the fixture server's real token or the canary into the artifact. This contradicts the file header's "keeps ... nothing else". Fix: store a stand-in for the path and query names when they hold a secret, as the judge messages do.
- scripts/tv-wire.mjs:186-197: the item 4 logcat judge reads the whole run with one `logcat -d` at the end, without `logcat -G` or streaming. On an image with a small main buffer, a canary or `Token="` line logged early in the roughly four-minute run can rotate out before the dump, and `judgeLogcat` passes a run that leaked. Unverified for the CI image. Fix: raise the buffer at the start of the run, or stream logcat, or record the buffer size in the evidence.
- scripts/tv-wire.mjs:183, 201-208: the device-global `http_proxy` is cleared only in a JavaScript `finally`, which Node does not run on SIGINT or SIGTERM. Ctrl+C during the 240 s wait, or a CI step timeout, leaves the emulator's global proxy at `127.0.0.1:47401` with no listener, and leaves the adb reverses, until the next `pnpm tv:wire` clears them (line 132). Fix: signal handlers that restore both, or a note in `docs/commands.md`.
- modules/session/android/src/main/java/dev/octave/session/http/SessionTransport.kt:165, 182-196, 204-205 and TokenStrip.kt:281-292: a body under the 32 MiB cap that is deeply nested JSON makes `strictJson`, `TokenStrip.strip` and `JsonElement.toString` recurse into a StackOverflowError; a 32 MiB body held as bytes, string, tree, re-serialised string and a Hermes string can raise OutOfMemoryError on a low-RAM TV. The `catch (Throwable)` at 204 reports both as `network` instead of `unexpected-response`, and an OOM can hit other threads. No token or native message leaks. Fix: bound the nesting depth, and map StackOverflowError and OutOfMemoryError to `unexpected-response`.
- apps/tv/babel.config.js:1-22: the plugin that removes `declare` class fields applies to the release bundle's transform, not only e2e. It is in the spec's decision log (milestone 4) but not in "Files to touch" or the PR call-outs. Removing the fields matches TypeScript's emit, so the risk is low, but a misread AST flag would change release code with no reviewer prompted. Fix: call it out in the PR as a release-path build change (Ship milestone).

## Validation evidence

Milestone 1, 2026-11-22: `mise exec -- pnpm check` (see the task's return evidence).

## Outcome & retrospective

Open.
