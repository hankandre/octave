# 010: T3-26 keep secrets out of the wire evidence

## Goal / Done when

Implement `docs/specs/T3-26.md` (T3-26).

- [x] Item 1: the recorder and the runner write a stand-in for a secret in a path, a query name, a Host, a scheme, an app line, a device line or a proxied Host; every file is read back
- [x] Item 2: `release-evidence/wire` is removed as the first statement of `main`; the entry guard compares real paths
- [x] Item 3: the logcat is streamed from before the app starts; the run fails when it cannot show the stream covered the run
- [x] Item 4: SIGINT and SIGTERM restore the proxy and remove the run's reverses
- [x] Item 5: `scripts/check-session-logs-cli.test.ts` asserts the summary line and file count
- [ ] Item 6: the `wire` job green on the PR head (Ship); the documents are written

## Context and domains touched

Security & Redaction; Node scripts under `scripts/`, docs only otherwise.

## Dependencies

None added.

## Milestones

1. Evidence and removal (items 1, 2). 2. Device and signals (item 4). 3. Kept log (item 3). 4. CLI guard (item 5). 5. Documents. 6. Device run and Ship.

## Progress

- [x] 1 to 5, in one commit (the modules depend on each other: the recorder imports the evidence module, the runner imports all three)
- [x] 6 device run on bf034584 (8 pairs pass; the spec's three device checks run on an own emulator): see Validation evidence; Ship runs the `wire` job

## Follow-ups (review, low; not fixed in this task)

- `scripts/tv-wire-judge.mjs:33-44` (`decodeRounds`): one malformed escape in a part stops all percent-decoding of it, so `/x/%74ok-abc123def456/%zz` is recorded with `secretInUrl` false and passes. Decode the valid `%XX` escapes one by one instead.
- `docs/commands.md:19`, `docs/security.md:98`: "a replacement fails every pair of the run" is true only for replacements at write time or at read-back. A stand-in the recorder writes at request time fails only its own pair (through the judge; `safeRecord` leaves a safe record unchanged). Fix the wording or count them as run errors.
- `scripts/tv-wire-evidence.test.ts:79-87, 347` (frozen): `SAFE_FORMS` has no standard base64 form and no raw canary in a path segment; the `writeSummary` test passes no secrets, so the summary scan is not asserted. Add them in a new test file.
- `scripts/tv-wire-device.mjs:161-170` with `scripts/tv-wire.mjs:235`: after the first signal later ones are ignored, and `adb` is a `spawnSync` with no timeout, so a hung adb call in `restore()` leaves only SIGKILL. The `onStop` path (stops the log stream) is untested.
- `scripts/tv-wire.mjs:318-320`: the done-line loop reads only streamed lines; if the stream exits early on a non-void attempt, the run waits the whole `RUN_MS` (240 s) before the cannot-tell failure. Leave the loop when the stream closes.

## Review fixes

- 2026-11-22: `safeUrlParts` works out "spans" per secret (a second secret crossing `?`, `&` or `=` was written in pieces once another secret held in one part); tests in `scripts/tv-wire-evidence-span.test.ts`. The log keeper's interval markers are now tested (`scripts/tv-wire-logcat-ticks.test.ts`: a dropped tick gives `missed` and the cannot-tell error).
- Item 6 gate stays open: the `wire` job has not run on the PR head. The local run and the spec's device checks are done (Validation evidence). Keep the PR a draft with no auto-merge until the job is green on the head and its `summary.txt` (with `transport-probe-then-signed-in jellyscale T3-05 pass`) and the kept-log line of its `device.txt` are quoted in the task evidence; only then set the task done.

## Decision log

- 2026-11-22: Spec check issue 1: the interval markers (`tick <nonce> <n>`, every 5 s) are the checkable signal; a missing one fails the run. The residual limit (a gap shorter than the interval; a slow-reader drop between two markers that arrived) is stated in `docs/security.md`. logd's slow-reader behaviour was not read from AOSP source or tested: unverified.
- 2026-11-22: Spec check issue 11: the stream has no `-b`, so it reads the same default buffers as the final dump.
- 2026-11-22: Spec check issue 6: `writeSummary` scans its lines too. Issue 8: only the first backlog line appended (the second duplicates entry 200). Issue 9: `.claude/skills/verify/SKILL.md:31` and `README.md:37` still read true; the header comment of `scripts/tv-wire.mjs` is updated.
- 2026-11-22: The recorder keeps the query names parsed (decoded once, `+` a space) as before; every part is checked raw and parsed.

## Surprises & discoveries

- Frozen test `scripts/tv-wire-evidence.test.ts`, "a writeEvidence error fails every pair and is printed" (line 396-400): its baseline pushes a second pair with `devicePort: 47301` but the same `PROBE` records, whose `host` is `127.0.0.1:47300`. The Host rule (`judgeRecords`) then fails that pair, so the baseline `every(pass)` cannot hold without weakening the Host check. Reported as a frozen-test problem; the Product Owner changed it in 072b75fc (second pair gets `host: "127.0.0.1:47301"`). Items 1 to 5 now pass.

## Validation evidence

2026-11-22, on commit bf034584 (code as of 70314ab2), own emulator (AVD `fluster_tv`, API 36, x86_64, a separate read-only instance), pinned fixture servers of this checkout. Not run: the CI `wire` job, arm64, the Shield (never, for this command), Android other than 16.

- `mise exec -- pnpm check`: exit 0 (`Test Files 99 passed (99)`, `Tests 2641 passed (2641)`; `Test Files 76 passed (76)`, `Tests 1426 passed (1426)`; workflow tests `pass 60`, `fail 0`).
- `ANDROID_SERIAL=<own emulator> mise exec -- pnpm tv:wire`: exit 0, `tv wire: 8 pair(s) passed; logcat clean, kept whole by streaming; global proxy saw 2 request(s), none naming a wire target`. `summary.txt`:

  ```
  transport-probe-then-signed-in mock T3-05 pass
  transport-probe-then-signed-in jellyfin-10-11 T3-05 pass
  transport-probe-then-signed-in jellyfin-12 T3-05 pass
  transport-probe-then-signed-in jellyscale T3-05 pass
  transport-redirect mock T3-05 pass
  transport-canary mock T3-05 pass
  transport-errors mock T3-05 pass
  transport-private-lan-and-proxy mock T3-05 pass
  ```

  Kept-log line of `device.txt`: `logcat kept by streaming from before the app started (the default buffers): 297 lines, start marker seen, end marker seen, 1 of 1 interval marker(s) seen, stream open to the end`. The command passed twice in a row.
- Planted `summary.txt` in the real directory, `ANDROID_SERIAL` naming no device: `ERROR tv wire: no device; ANDROID_SERIAL names no attached, booted device`, exit 1, and `release-evidence/wire` no longer exists.
- SIGINT to the runner 2 s after the proxy was set (11 reverses listed): `ERROR tv wire: stopped by SIGINT; the device's http_proxy and adb reverses were restored`, exit 130; `settings get global http_proxy` prints `:0`, `adb reverse --list` prints nothing, no `summary.txt`. SIGTERM was not sent on a device (covered by `scripts/tv-wire-device.test.ts` only).
- The runner's own `adb logcat` child killed 3 s after the proxy was set: exit 1 with `ERROR tv wire: cannot tell that the run's whole log was kept: the end marker never arrived on the stream; the stream had closed before the end of the run; 48 of 48 interval marker(s) never arrived on the stream`, a `fail` line for each of the 8 pairs, proxy `:0` and no reverse afterwards. The run waited the whole 240 s first, as the last follow-up above says.
