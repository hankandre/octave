# 012: T1-16 review follow-ups

## Goal / Done when

Fix the T1-16 fresh-context review's medium finding and record its lows (T1-16).

- [x] Medium fixed: a logCommit from an earlier run no longer counts as the log entry of a new ruling
- [x] Lows below logged as follow-ups, not fixed
- [x] T1-16 set to done with evidence naming the commit

## Context and domains touched

Process (the task workflow under `.claude/workflows/`). The spec at `docs/specs/T1-16.md` holds the rules.

## Dependencies

None added.

## Milestones

1. **Fix the stale-sha finding and log the lows.** Validation: `mise exec -- pnpm check`.

## Progress

- [x] 1

## Decision log

- 2026-11-22: The fix seeds `usedCommits` from `ruling-log.mjs --history`, which now lists the commits on HEAD that added a ruling section for the task. A new gate call was not added, because the frozen tests assert the call order. The in-run reuse check now also matches a short sha against a full one.

## Surprises & discoveries

Follow-ups (low, not fixed in T1-16):

- .claude/workflows/ruling-log.mjs:50-55: the check accepts any commit that adds a heading for the task. It does not check that the section holds a line for each asked rule key, so an empty or unrelated section counts as logged and later rule counts from rulingHistory can be wrong.
- .claude/workflows/task.js (planRuling, totalRulings = history.sections): the cap is cumulative per task across runs, but the block message says "in one run". A task resumed twice can block earlier than the spec's cap suggests.
- tasks/product-owner-log.md (2026-11-22 T1-16 ruling) and ruling-log.mjs:68: frozen-test ruling line keys are free text such as "[frozen test: item 1, ...]", not the prompt's "[frozen-test]"; parseRulingHistory counts each as its own key and could pollute ruleCounts.
- .claude/workflows/task-rulings.test.mjs: no frozen test covers a valid logCommit that predates the ruling. The new file task-rulings-history.test.mjs covers the stale-sha case only.
- Commit 26daf1d3 edited a frozen test file by a Product Owner ruling (three "implement (after ruling)" fixture answers, one rule key). It carries a Frozen-Test-Change trailer and a log section. No assertion was weakened. The PR's Frozen tests section must name this change.
