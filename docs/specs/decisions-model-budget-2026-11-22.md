# Model budget decisions, 2026-11-22

The owner's direction of 2026-11-22 on model spend, relayed by the coordinator, and the coordinator's proposals that follow from a measurement of the session transcripts. The owner can veto any proposal. A Product Owner pass places the backlog lines it names; the placement is the Product Owner's.

## What the owner said

1. Make the workflow as affordable as it can be, while the work keeps getting guidance and stays on task.
2. Fable 5.2 stays important and stays the Product Owner, but the workflow should call it less.
3. Fable 5.2 should give its view of the product's direction at regular intervals, narrowly scoped, for example at the end of every phase.
4. Between those views, someone cheaper (Opus 5.5 if it serves) keeps the work on task.
5. The advisor is off in workflow runs and stays on in the owner's interactive sessions (proposal F).
6. The direction review runs when a phase is complete or after 10 merged tasks since the last review, whichever comes first (proposal C).

## What the measurement showed

Measured on 2026-11-22 from the transcripts of the main coordinator session and its subagents (7 to 22 November), priced with the API list prices of 2026-11-03 (Fable 5.2 $8 / $40, Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10 per million tokens; cache reads $0.20, $0.20, $0.10). Cache-write prices are approximate and the dollar figures are estimates; the shares hold either way.

- Since 19 November (about $1,880): advisor calls about 35%; Fable spec, check and Product Owner work about 17%; the coordinator session (one Opus session since 7 November, about 395k tokens of context per turn) about 8%; ad hoc Opus agents (mostly the TV pivot) about 8%.
- Advisor calls: every agent, Opus and Sonnet ones included, calls the advisor tool, which runs on Fable 5.2 with no cache (one call read 87,295 uncached input tokens). The workflow made 483 such calls, about $653, rising from $94 on 20 November to $387 on 22 November. Refiners ($170), native engineers ($122), spec checkers ($62), test writers ($62) and the Product Owner ($59) call it most. Its tokens sit in `usage.iterations`, not in a message's top-level usage, so a sum of top-level usage misses them.
- In lane mode a task runs as high risk only when its `model` in `tasks/prd.json` is `fable` (`.claude/workflows/task.js`, `routeFor`). A batch run (`tasks: [...]`) applies its one `risk` to every task. Fable as the spec or check model cost about $241: $136 for 19 tasks put on Fable by batches run with `risk: "high"`, $101 for 11 tasks marked `fable`.
- Inline Product Owner rulings inside task runs cost about $8 in all. Ad hoc Product Owner calls from the coordinator cost about $78, much of it recording answers and placing single follow-ups.
- Ship agents took a median of 26 minutes, 93 at the 90th percentile. The slowest (T5-02, 174 minutes) met `DIRTY` repeatedly and rebased three times; three commits on `main` drop backlog lines that a union merge kept twice.

## Proposals (the owner can veto any of them)

### A. Where Fable is used

- Fable 5.2 keeps: Product Owner passes, frozen-test rulings, inline rulings in task runs, the spec and spec check of a task the Product Owner marks `model: fable`, the spec check of every native task (`check.native` in `task.js`, pinned by a frozen test), and the direction review of proposal C.
- The Product Owner marks a task `fable` only for native, security, token, negotiation or architecture work, or a plan or decision record, and re-judges the open markings against that rule at its next pass (T12-08, a `ui` feature task, is marked `fable` today).
- Fable is not used for recording owner answers, for a run-wide `risk: "high"` batch, or for research the owner did not ask Fable for.

### B. How the coordinator works (no code change)

- One fresh coordinator session on Sonnet 5.5 per lane run, as `WORKFLOW.md` model routing already says.
- Start tasks with lane mode (`{lanes: [...]}`), which routes each task by its own `model`, rather than a batch with one `risk`.
- Give every ad hoc agent an explicit model; an agent without one inherits the coordinator's.
- Write owner answers into a decision file itself, and collect placements for one Product Owner pass instead of one Product Owner call each.

### C. A Fable direction review at regular intervals (backlog line)

A narrowly scoped, read-only Fable review that says whether the work still serves `PRODUCT.md`:

- It runs when a phase's tasks are all done, or after 10 merged tasks since the last review, whichever comes first (the owner's decision 6).
- Its input is a digest a script builds (the tasks merged since the last review with their evidence lines, the Product Owner log sections since then, the parked questions, the untaken backlog count, the roadmap section of `PRODUCT.md`), not the whole repository.
- It writes one page: on track or drifting and why, the three things that matter most next, and questions for the owner. It may append backlog lines; it edits no task and no acceptance item.
- Between reviews the per-task checks stay as they are (the Opus spec check, the review, the inline Product Owner rulings), and an Opus 5.5 status note on the same digest closes each lane run, so drift shows up before the next Fable review.

### D. Batch runs route each task by its own model (backlog line)

A batch run routes each task by the task's `model`, as lane mode does, so one high-risk task no longer puts a whole batch on Fable.

### E. Find what makes Ship branches conflict (backlog line)

Find which files put task branches in `DIRTY` and cause the duplicated backlog lines, and propose how to stop it, for the owner to decide.

### F. No advisor in workflow runs (decided by the owner, decision 5)

- The owner's user settings set `advisorModel` to `fable`, and every subagent inherits it (https://code.claude.com/docs/en/advisor.md). Claude Code has no setting that scopes the advisor to one agent or caps its calls; `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` turns it off for a whole session.
- A coordinator session that starts a lane or batch run is therefore launched with `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` (`docs/commands.md`). Interactive sessions keep the Fable advisor. Fable's view reaches the workflow through the direction review of proposal C and the Product Owner instead.
- `scripts/pipeline-cost.mjs` reads only top-level usage and misses advisor tokens (backlog line).
