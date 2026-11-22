# 014: T1-19 review follow-ups

## Goal / Done when

Record the T1-19 fresh-context review's findings so the owner and later tasks see them (T1-19).

- [x] The medium finding fixed with a test
- [x] Lows below logged as follow-ups, not fixed
- [x] T1-19 set to done with evidence naming the commit

## Context and domains touched

Process (the task workflow under `.claude/workflows/`). The spec at `docs/specs/T1-19.md` holds the rules.

## Dependencies

None added.

## Milestones

1. **Fix the medium and log the lows.** Validation: `mise exec -- pnpm check`.

## Progress

- [x] 1

## Decision log

- 2026-11-22: Medium (a lane queued for the serial slot ignored a denial): each phase that takes the slot (tests, implement, follow-ups) now calls `holdSlotOrHalt(phase)`, which re-checks `opts.halted()` after `holdSlot()` returns. Test: `.claude/workflows/task-lanes-slot-halt.test.mjs` (fails without the fix).

## Surprises & discoveries

Follow-ups (low, not fixed in T1-19):

- .claude/workflows/lane-state.mjs:36-46: `fetchOrigin` is `git fetch -q origin` with no `--prune`, and `inFlight` is built from `refs/remotes/origin/task/`. A task/<ID> branch deleted on the remote leaves a stale tracking ref, so a todo or in_progress task of the lane reports as in flight and the lane stops `lane-busy` forever. Fix: fetch with `--prune`, or confirm the remote ref with `ls-remote`.
- docs/specs/T1-19.md:83,281 and the PR evidence: it is not verified that the Workflow runtime runs overlapping `agent()` calls in parallel. If it serialises them, lane mode runs no faster than a batch. The PR body must record what the first real lane run showed (Ship phase); if they serialise, file the fallback line in tasks/backlog.jsonl (spec note 8).
- .claude/workflows/task.js (`runLanes`) with the fixed fixture ports 18096-18098: the spec's `core` row (docs/specs/T1-19.md:94) relies on T3-27 giving each worktree its own ports, but docs/commands.md still says the ports are fixed and only one checkout can have servers up. Two parallel lanes that both run `fixture:up` (for example core and tv-scripts) can collide. Not caught by tests. Document it, or make the ports per-worktree, before relying on parallel core lanes.

## Validation evidence

See the task evidence and the commit that adds this plan.
