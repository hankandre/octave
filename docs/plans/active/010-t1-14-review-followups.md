# 010: T1-14 review follow-ups

## Goal / Done when

Record the T1-14 fresh-context review's low findings so the owner and later tasks see them (T1-14).

- [x] Review found nothing needing a fix
- [x] Lows below logged as follow-ups, not fixed
- [x] T1-14 set to done with evidence naming the commit

## Context and domains touched

Process (the task workflow under `.claude/workflows/`). The spec at `docs/specs/T1-14.md` holds the rules.

## Dependencies

None added.

## Milestones

1. **Log the review's lows.** Validation: `mise exec -- pnpm check`.

## Progress

- [x] 1

## Decision log

- 2026-11-22: No review finding needs a fix; the three lows are logged, not fixed.

## Surprises & discoveries

Follow-ups (low, not fixed in T1-14):

- .claude/workflows/fixtures-down.mjs:20-35: teardown after Ship deletes the worktree hashes only the resolved path string. If the worktree path runs through a symlink, the fixtures were started under the real-path hash, so the teardown computes a different name, reports "none running" and leaves ports 18096-18098 held. The spec accepts this (`docs/specs/T1-14.md:173`).
- .claude/workflows/task.js:620-626 (`withTeardown` in the batch loop): a throw from `runTask` now becomes outcome `failed`, which is not in `STOP_OUTCOMES`, so a multi-task batch continues to the next task (before, an uncaught error aborted the run). The spec specifies this (`docs/specs/T1-14.md:163`). Check that it is intended for dependent tasks: an agent crash on task A lets task B start on a possibly broken base.
- .claude/workflows/branch-sync.mjs:73-76: a failed `git fetch origin main` blocks the task outright, even when the branch is already up to date against a stale origin/main (resuming offline returns `blocked`). `--no-fetch` exists, but `task.js` never passes it.
