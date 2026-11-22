# Pipeline cost per merged task

Task T1-20. This report measures what each stage of the task workflow costs per merged task, and proposes lighter pipelines for small low-risk tasks. The owner decides. No stage is cut or changed by this task.

## How the numbers were taken

- Date: 2026-11-22.
- Command: `node scripts/pipeline-cost.mjs --merged T3-02,T3-03,T3-23 --json`, run read-only on the owner's machine. It reads every `task` workflow journal under the Claude projects folder and the subagent transcripts beside them.
- Journals read: 290 journal files, of which 121 are `task` runs. The run saw 1,005 agents, 0 without a transcript, and 0 it could not attribute to a task. The script does not print journal dates; the spec read the `task` journals as covering 2026-11-10 to 2026-11-22, and that range is not rechecked here.
- The script found 71 merged tasks. 33 are T-tasks (30 recorded as merged in a journal, plus T3-02, T3-03 and T3-23, which were merged after their run and are passed with `--merged`). The other 38 are P-tasks, desktop-era tasks that ran an earlier pipeline without a tests-first step. They are left out of every table here.
- 16 tasks have runs but no merge record (not shipped, or shipped outside any journal). They are not in the tables.
- A stage's wall time is the sum of its agents' `durationMs`. Stages run in sequence for one task, so the stage sums add up to the task's wall time spent inside runs.
- Token columns come from the transcripts' `message.usage`, each message counted once: input, cache write, cache read, output. They are tokens consumed, not money. The journal's own `tokens` field (printed as `context`) is the size of an agent's context at its last turn, not usage, and this report does not use it as a cost.
- "Tokens" in the stage tables is the sum of all four classes. Cache read dominates it (about 95% of the sum), and a cache read is billed far below an input or output token, so compare stages by cache write and output as well as by the sum. Money is not given, because this report cites no price page for the cache classes.
- Every agent is counted for a merged task, whatever its run's outcome: a stopped, resumed or killed run counts too. That is the true cost of getting the task merged.
- The "High-risk path" column is a measured proxy, not the spec's own risk label, because the specs do not state a risk in one fixed form. It is `path` when the task's commits on main touch a file that `HIGH_RISK_PATH` in the task workflow matches (which also sends the diff to a `guardian` review), `native` when they touch `modules/` or `apps/tv/android/`, and `none` otherwise. "native" tasks also match the high-risk path. The "Agents" column replaces a run count, because the script's pinned output has no run count.

## What the journals do not record

- The coordinator session. Its own model calls, which start each run and read its result, are in the session transcript, not in any journal. They are not counted.
- Time between runs: a resumed task waiting for the owner, a ruling or a parked question.
- Phase timing. Phase entries carry no time, so a stage's wall time is the sum of its agents'.
- Who waited for CI. The Ship agent's wall time includes its wait for CI and the auto-merge. On T9-07 the ship agent ran 89 of a 113-minute run, with long gaps between transcript lines that hold no model call. That this is CI waiting is inferred, not recorded. CI minutes themselves are not recorded.
- Human time: the owner's reviews, approvals, device gates and veto passes.
- The token split in the journal: it gives one `tokens` number per agent. The split is only in the transcripts.
- Money. No journal field gives a cost, and there is no price per token in the repository for the cache classes.
- Work outside a run: tasks shipped after their run (T3-02, T3-03, T3-23) and done tasks that have no journal at all (T0-05, T1-01 to T1-09, T1-11, T1-15, T1-16, T1-18, T2-01, T3-28) are not recorded.
- Retention. Claude Code may delete old session folders. These numbers are a snapshot taken while the transcripts exist.

The numbers below therefore undercount: they leave out the coordinator, the owner's time and CI minutes.

## Cost per merged task

One row per merged T-task. Token columns are in thousands (k) except input. T3-02, T3-03 and T3-23 are "merge not recorded": their runs are counted, their merge is not in a journal. Done tasks with no journal at all (T0-05, T1-01 to T1-09, T1-11, T1-15, T1-16, T1-18, T2-01, T3-28) are "not recorded". 38 P-tasks are left out.

| Task | High-risk path | Agents | Wall (min) | Input | Cache write | Cache read | Output | Note |
|---|---|---|---|---|---|---|---|---|
| T1-10 | path | 7 | 28 | 212 | 563k | 7,877k | 107k |  |
| T1-12 | none | 8 | 58 | 292 | 944k | 12,381k | 227k |  |
| T1-13 | none | 8 | 28 | 182 | 482k | 4,002k | 70k |  |
| T1-14 | none | 11 | 47 | 232 | 645k | 7,522k | 127k |  |
| T1-17 | none | 15 | 132 | 294 | 1,095k | 8,658k | 174k |  |
| T2-02 | path | 13 | 67 | 486 | 1,023k | 18,691k | 190k |  |
| T2-03 | path | 13 | 40 | 352 | 785k | 9,864k | 125k |  |
| T2-04 | path | 13 | 83 | 532 | 1,471k | 39,066k | 323k |  |
| T2-05 | path | 13 | 81 | 560 | 1,290k | 30,168k | 259k |  |
| T2-06 | path | 11 | 57 | 244 | 759k | 7,220k | 116k |  |
| T2-07 | path | 16 | 80 | 530 | 1,522k | 23,432k | 280k |  |
| T2-08 | path | 25 | 74 | 548 | 1,453k | 18,396k | 200k |  |
| T2-09 | none | 12 | 85 | 420 | 1,144k | 25,316k | 192k |  |
| T2-10 | none | 11 | 37 | 180 | 518k | 3,641k | 61k |  |
| T3-01 | none | 14 | 128 | 690 | 1,541k | 41,438k | 318k |  |
| T3-02 | path | 18 | 90 | 568 | 1,370k | 28,939k | 271k | merge not recorded |
| T3-03 | native | 26 | 138 | 890 | 2,054k | 46,926k | 436k | merge not recorded |
| T3-04 | path | 15 | 100 | 592 | 1,341k | 32,990k | 362k |  |
| T3-05 | native | 29 | 245 | 1166 | 3,189k | 77,781k | 592k |  |
| T3-06 | none | 28 | 114 | 680 | 1,429k | 26,111k | 301k |  |
| T3-15 | native | 19 | 99 | 638 | 1,534k | 26,415k | 244k |  |
| T3-16 | native | 20 | 168 | 946 | 1,953k | 50,060k | 386k |  |
| T3-19 | path | 32 | 368 | 1780 | 4,163k | 108,476k | 863k |  |
| T3-20 | native | 13 | 128 | 514 | 1,256k | 23,036k | 256k |  |
| T3-22 | none | 11 | 98 | 386 | 1,066k | 15,852k | 171k |  |
| T3-23 | path | 21 | 90 | 438 | 1,408k | 12,901k | 200k | merge not recorded |
| T3-24 | native | 17 | 109 | 514 | 1,282k | 20,205k | 200k |  |
| T3-25 | native | 14 | 179 | 476 | 1,226k | 18,591k | 190k |  |
| T3-26 | path | 16 | 97 | 416 | 1,320k | 15,076k | 213k |  |
| T3-30 | path | 19 | 265 | 640 | 2,399k | 27,002k | 261k |  |
| T8-22 | path | 20 | 102 | 408 | 1,167k | 12,842k | 163k |  |
| T8-24 | path | 13 | 67 | 264 | 747k | 8,187k | 89k |  |
| T9-07 | path | 16 | 123 | 242 | 830k | 5,549k | 131k |  |

Median task: 97 minutes of agent wall time and 20.1M tokens (all four classes). Across the 33 tasks: 3,604 minutes.

## Cost per stage

All 33 T-tasks. Share of wall time and of tokens is within the group's total. Median per task is over the tasks that ran the stage.

| Stage | Tasks with stage | Agents | Sum wall (min) | Median wall per task (min) | Share of wall | Sum tokens | Median tokens per task | Share of tokens |
|---|---|---|---|---|---|---|---|---|
| Spec | 33 | 58 | 495 | 14.1 | 13.7% | 129,893k | 3,200k | 15.0% |
| Sync gate | 8 | 12 | 1 | 0.1 | 0.0% | 871k | 73k | 0.1% |
| Check | 33 | 46 | 277 | 6.8 | 7.7% | 42,158k | 926k | 4.9% |
| Ruling | 8 | 8 | 17 | 1.3 | 0.5% | 5,493k | 413k | 0.6% |
| Tests | 30 | 39 | 278 | 7.6 | 7.7% | 130,770k | 3,008k | 15.1% |
| Red gate | 29 | 31 | 7 | 0.2 | 0.2% | 2,335k | 74k | 0.3% |
| Implement | 33 | 51 | 561 | 14.1 | 15.6% | 345,705k | 6,261k | 39.8% |
| Frozen gate | 30 | 76 | 11 | 0.3 | 0.3% | 5,795k | 159k | 0.7% |
| Review | 33 | 104 | 434 | 10.4 | 12.1% | 138,555k | 3,251k | 16.0% |
| Green gate | 30 | 33 | 10 | 0.3 | 0.3% | 2,604k | 74k | 0.3% |
| Ship | 33 | 43 | 1420 | 28.1 | 39.4% | 39,297k | 724k | 4.5% |
| Fix CI | 10 | 21 | 91 | 4.3 | 2.5% | 23,168k | 719k | 2.7% |
| Fixtures down | 8 | 15 | 2 | 0.2 | 0.0% | 1,052k | 73k | 0.1% |

Gate stages (Sync, Red, Frozen, Green, Fixtures down, Ruling log) together: a median task runs 4 gate agents out of 15, which take about 0.9 minutes and 358k tokens (140k of cache write). Over the 33 tasks that is 12.7M tokens. Ship is the largest block of wall time (39%) but only 4.5% of tokens, which fits waiting for CI. Implement is the largest block of tokens (40%).

Routine versus high-risk is shown here by the measured proxy, not by a spec label.

### Tasks with no high-risk path (9 tasks)

T1-12, T1-13, T1-14, T1-17, T2-09, T2-10, T3-01, T3-06, T3-22. Median task: 85 minutes and 13.6M tokens.

| Stage | Tasks with stage | Agents | Sum wall (min) | Median wall per task (min) | Share of wall | Sum tokens | Median tokens per task | Share of tokens |
|---|---|---|---|---|---|---|---|---|
| Spec | 9 | 13 | 118 | 12.3 | 16.3% | 30,008k | 2,883k | 19.3% |
| Sync gate | 2 | 3 | 0 | 0.1 | 0.0% | 217k | 109k | 0.1% |
| Check | 9 | 12 | 55 | 4.1 | 7.5% | 9,808k | 497k | 6.3% |
| Ruling | 2 | 2 | 2 | 1.2 | 0.3% | 992k | 496k | 0.6% |
| Tests | 7 | 9 | 39 | 4.8 | 5.4% | 15,802k | 1,673k | 10.2% |
| Red gate | 7 | 7 | 1 | 0.2 | 0.2% | 528k | 73k | 0.3% |
| Implement | 9 | 11 | 124 | 11.5 | 17.1% | 69,928k | 5,894k | 45.0% |
| Frozen gate | 7 | 15 | 2 | 0.2 | 0.2% | 1,128k | 152k | 0.7% |
| Review | 9 | 21 | 58 | 6.2 | 8.0% | 17,967k | 1,199k | 11.6% |
| Green gate | 7 | 7 | 2 | 0.2 | 0.2% | 523k | 73k | 0.3% |
| Ship | 9 | 11 | 321 | 28.1 | 44.2% | 7,755k | 872k | 5.0% |
| Fix CI | 2 | 2 | 3 | 1.7 | 0.5% | 449k | 225k | 0.3% |
| Fixtures down | 2 | 5 | 0 | 0.2 | 0.1% | 326k | 163k | 0.2% |

### Tasks that touch a high-risk path (24 tasks)

Median task: 98 minutes and 23.1M tokens.

| Stage | Tasks with stage | Agents | Sum wall (min) | Median wall per task (min) | Share of wall | Sum tokens | Median tokens per task | Share of tokens |
|---|---|---|---|---|---|---|---|---|
| Spec | 24 | 45 | 376 | 14.8 | 13.1% | 99,885k | 3,972k | 14.0% |
| Sync gate | 6 | 9 | 1 | 0.1 | 0.0% | 654k | 73k | 0.1% |
| Check | 24 | 34 | 222 | 6.9 | 7.7% | 32,350k | 1,000k | 4.5% |
| Ruling | 6 | 6 | 14 | 1.3 | 0.5% | 4,500k | 413k | 0.6% |
| Tests | 23 | 30 | 239 | 8.4 | 8.3% | 114,968k | 3,538k | 16.1% |
| Red gate | 22 | 24 | 6 | 0.2 | 0.2% | 1,806k | 74k | 0.3% |
| Implement | 24 | 40 | 437 | 14.2 | 15.2% | 275,778k | 6,832k | 38.7% |
| Frozen gate | 23 | 61 | 9 | 0.3 | 0.3% | 4,668k | 163k | 0.7% |
| Review | 24 | 83 | 376 | 11.5 | 13.1% | 120,587k | 3,914k | 16.9% |
| Green gate | 23 | 26 | 9 | 0.3 | 0.3% | 2,081k | 74k | 0.3% |
| Ship | 24 | 32 | 1099 | 27.9 | 38.2% | 31,541k | 630k | 4.4% |
| Fix CI | 8 | 19 | 88 | 4.8 | 3.1% | 22,719k | 830k | 3.2% |
| Fixtures down | 6 | 10 | 1 | 0.2 | 0.0% | 726k | 73k | 0.1% |

Small differences: tasks with no high-risk path spend about the same wall time on Ship (28.1 minutes median), less on Check (4.1 against 6.9 minutes) and Review (6.2 against 11.5), and have a median of 11 agents against 16. Only 9 tasks are in that group, so these are indications, not rates.

## Options for small low-risk tasks

**Definition.** A "small low-risk" task is one that is risk `routine`, has no path the workflow sends to `guardian` (the task's diff matches no `HIGH_RISK_PATH` file), nothing native, and at most four acceptance items. The script measures the first three through the proxy above (9 of 33 tasks match). It does not read acceptance counts, so the fourth condition is not applied to the numbers.

Every "Saves" figure is a median per task from the tables above (tasks with no high-risk path where marked, otherwise all 33). Tokens count all four classes, so they overstate the price effect of a cache read. Wall time saved is an upper bound.

| Option | Saves | Gives up | Rule or check it touches |
|---|---|---|---|
| 1. Run the mechanical gates (sync, red, frozen, green, fixtures down) as commands inside the coordinator or the next agent, not one agent each | 4 agents of 15 per task, 0.9 min wall and 358k tokens (140k cache write); small tasks: 4 of 11 agents, 305k tokens | No check: the same commands run and still fail the stage. It gives up only the separate agent relaying each result | `.claude/workflows/task.js` gate steps; `check-red.mjs` and the frozen gate are unchanged |
| 2. Hand the CI wait in Ship to a polling loop, or to the cheaper `scout` model that WORKFLOW.md already names for watching PRs | 0 min wall (the wait stays); moves 724k tokens per task from the Ship agent to a cheaper model (872k on small tasks); Ship is 28.1 min and 39% of wall | No check. The merge rule and CI are untouched. It gives up the Ship agent's judgement while waiting, such as spotting a flaky run early | WORKFLOW.md model routing for Ship |
| 3. Skip the separate spec check for small routine tasks | 6.8 min wall and 926k tokens per task (4.1 min and 497k on tasks with no high-risk path) | The fresh-context review of the spec (WORKFLOW.md section 2a), which catches a spec that tests the wrong thing before tests are frozen | Spec check; the Check stage |
| 4. Write the spec of a small routine task with Sonnet instead of Opus | 14.1 min and 3.2M tokens per task move to a cheaper model (12.3 min and 2.9M on small tasks). Wall time is not shown to fall | The stronger refiner for the spec | Model routing for Spec |
| 5. For a docs-only or process-docs task, fold Tests into Implement | 7.6 min wall and 3.0M tokens for the Tests stage, plus 0.2 min for the red gate and 0.3 min for each frozen gate | Frozen failing tests (WORKFLOW.md section 2b) for that task. The reviewer would judge the docs by reading them | Tests-first flow; `check-red.mjs` |
| 6. Run `pnpm check` and the frozen gate before Ship, so CI is not first to fail | 4.3 min wall and 719k tokens per task on the 10 tasks that needed a Fix CI agent (91 min and 23.2M tokens in all). Whether the failures were avoidable locally is unverified | No check, if the local run matches CI. It costs the extra local run | Ship; Fix CI step |

Options 1, 2 and 6 give up no check. Options 3 to 5 give up a check and are the ones that need a judgement about risk.

Not proposed: dropping the Review stage. It is 12.1% of wall time and 16.0% of tokens, and it is the only independent look at the diff.

## For the owner to decide

This task changes no stage. It does not touch `.claude/`, `WORKFLOW.md` or `AGENTS.md`, and no stage is cut or changed by it. The owner decides which options, if any, to take.

Recommendation: take options 1 and 2 first. They give up no check, and together they remove about a quarter of the agents in a median task (4 of 15) and move the largest wall-time block (Ship, 39%) onto a cheaper watcher. They do not shorten wall time much, because the CI wait stays; if wall time is the pain, only options 3 to 6 reduce it, and only by 5 to 14 minutes each against a median 97-minute task. Take option 3 for small tasks only if a measured miss rate for spec checks says the check rarely finds anything; this report has no such rate, so that call is the owner's. Leave option 5 for later, because frozen tests are the pipeline's strongest check.

A chosen option becomes its own task through a Product Owner pass, with its own spec, tests and review.
