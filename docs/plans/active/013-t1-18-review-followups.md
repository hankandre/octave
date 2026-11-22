# 013: T1-18 review follow-ups

## Goal / Done when

Record the T1-18 fresh-context review's findings so the owner and later tasks see them (T1-18).

- [x] The medium finding fixed with a test
- [x] Lows below logged as follow-ups, not fixed
- [x] T1-18 set to done with evidence naming the commit

## Context and domains touched

Process (the task workflow under `.claude/workflows/`). The spec at `docs/specs/T1-18.md` holds the rules.

## Dependencies

None added.

## Milestones

1. **Fix the medium and log the lows.** Validation: `mise exec -- pnpm check`.

## Progress

- [x] 1

## Decision log

- 2026-11-22: Medium (a missing `leftFindings` read as nothing left): the follow-ups step now also returns `fixedFindings`, and `unaccountedLows(lowCount, followUp)` counts the lows the review returned minus the fixed and the left ones. It does not block, because the frozen test "a follow-up with no leftFindings ends merged with left: []" requires that outcome; the count goes in the log, the result's `unaccountedLows` and the Ship prompt, which asks for a check of the diff and the backlog. Tests: `.claude/workflows/task-followups-accounting.test.mjs`.

## Surprises & discoveries

Follow-ups (low, not fixed in T1-18):

- .claude/workflows/task-followups.test.mjs:125: acceptance item 2 (no plan line, no backlog line that asks for a task of its own, no edit to tasks/prd.json, no duplicate what) is checked only as prompt text. A model that ignores the prompt is caught only by the duplicate-what lint in pnpm check. This follows the spec's own "prompt text only" line.
- .claude/workflows/task.js:753: a denied follow-up, a guarded() stop, or an empty follow-up ends before planLeft runs, so realTvGates is lost on those outcomes even though the step may already have committed a gating backlog line. The spec states this. The line stays in the branch, but the result does not show the gate to the Product Owner.

## Validation evidence

See the task evidence and the commit that adds this plan.

## Outcome & retrospective

Open.
