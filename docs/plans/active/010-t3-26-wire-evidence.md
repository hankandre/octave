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
- [ ] 6 device run: see Validation evidence; Ship runs the `wire` job

## Decision log

- 2026-11-22: Spec check issue 1: the interval markers (`tick <nonce> <n>`, every 5 s) are the checkable signal; a missing one fails the run. The residual limit (a gap shorter than the interval; a slow-reader drop between two markers that arrived) is stated in `docs/security.md`. logd's slow-reader behaviour was not read from AOSP source or tested: unverified.
- 2026-11-22: Spec check issue 11: the stream has no `-b`, so it reads the same default buffers as the final dump.
- 2026-11-22: Spec check issue 6: `writeSummary` scans its lines too. Issue 8: only the first backlog line appended (the second duplicates entry 200). Issue 9: `.claude/skills/verify/SKILL.md:31` and `README.md:37` still read true; the header comment of `scripts/tv-wire.mjs` is updated.
- 2026-11-22: The recorder keeps the query names parsed (decoded once, `+` a space) as before; every part is checked raw and parsed.

## Surprises & discoveries

- Frozen test `scripts/tv-wire-evidence.test.ts`, "a writeEvidence error fails every pair and is printed" (line 396-400): its baseline pushes a second pair with `devicePort: 47301` but the same `PROBE` records, whose `host` is `127.0.0.1:47300`. The Host rule (`judgeRecords`) then fails that pair, so the baseline `every(pass)` cannot hold without weakening the Host check. Left unchanged and reported as a frozen-test problem; the fix is `host: "127.0.0.1:47301"` on the second pair's records.

## Validation evidence

See the task's evidence and the PR body.
