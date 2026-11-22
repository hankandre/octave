# 014: T1-20 review follow-ups

## Goal / Done when

Record the T1-20 fresh-context review's findings so the owner and later tasks see them (T1-20).

- [x] No finding needed a fix
- [x] Lows below logged as follow-ups, not fixed
- [x] T1-20 set to done with evidence naming the commit

## Context and domains touched

Process (docs/research and scripts). The spec at `docs/specs/T1-20.md` holds the rules.

## Dependencies

None added.

## Milestones

1. **Log the lows.** Validation: `mise exec -- pnpm check`.

## Progress

- [x] 1

## Decision log

- 2026-11-22: No review finding needed a fix; the lows stay as follow-ups.

## Surprises & discoveries

Follow-ups (low, not fixed in T1-20):

- docs/research/pipeline-cost.md (How the numbers were taken, high-risk path column): the risk proxy (`path`/`native`/`none`) comes from the commits each task made on main and the workflow's HIGH_RISK_PATH; the script does not compute it, so a rerun cannot reproduce that column or the high-risk versus routine split. Add the derivation command or mark the split as unverified.
- docs/research/pipeline-cost.md (options definition): the proposed "small low-risk" definition has four conditions, but the report applies three (9 of 33 tasks match), so the "Saves" figures describe a looser group. The report says so; it is a caveat for the owner's decision.
- scripts/pipeline-cost.mjs:main (argv loop): a bare `--projects` pushes an empty string, and unknown flags are ignored, so a typo such as `--merge T3-02` silently falls back to the default and drops the extra task. Impact is small; nothing leaks.
- docs/specs/T1-20.tests.json item 4 (gate: review): holds; no path under .claude/workflows, agents, skills, WORKFLOW.md or AGENTS.md changed. Nothing to fix.
- scripts/pipeline-cost.test.ts, scripts/pipeline-cost-report.test.ts: the reviewer did not read the frozen tests line by line; the script was checked against the spec's allowlist, stage table, attribution and output rules with no deviation.

## Validation evidence

See the task evidence and the commit that adds this plan.
