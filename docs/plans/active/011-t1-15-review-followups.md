# 011: T1-15 review follow-ups

## Goal / Done when

Record the T1-15 fresh-context review's low findings so the owner and later tasks see them (T1-15).

- [x] Review found nothing needing a fix
- [x] Lows below logged as follow-ups, not fixed
- [x] T1-15 set to done with evidence naming the commit

## Context and domains touched

Process (the task workflow under `.claude/workflows/`). The spec at `docs/specs/T1-15.md` holds the rules.

## Dependencies

None added.

## Milestones

1. **Log the review's lows.** Validation: `mise exec -- pnpm check`.

## Progress

- [x] 1

## Decision log

- 2026-11-22: No review finding needs a fix; the four lows are logged, not fixed.

## Surprises & discoveries

Follow-ups (low, not fixed in T1-15):

- .claude/workflows/task.js:581-583: the follow-up gate still passes a result with done and checksPassed true and failures listed. The spec marks this out of scope, and the green gate that follows reruns every frozen test. The failures are dropped silently; the only trace is the ciOnly log line.
- .claude/workflows/task.js:594-603: `from: "ship"` trusts that a review round ran earlier and nothing enforces it. A stray `from: "ship"` on an unreviewed branch would ship without review. WORKFLOW.md states the restriction and the spec accepts it as a risk.
- .claude/workflows/task.js:392-401 and `decideGreen`: a green gate that is unreadable twice returns outcome blocked with detail 'the green gate gave no readable result twice', not a batch stop. This matches the spec's reading of "stops as unreadable" and keeps `STOP_OUTCOMES` unchanged; noted because the acceptance wording could be read as a stop.
- .claude/workflows/task.js:370-376: `work()` no longer carries ciOnly across attempts. A ciOnly item reported only by a non-green first attempt is lost when a later attempt is green and does not repeat it. This is the intended fix for backlog entry 85; a CI-only step the retry omits is not handed to Ship.
