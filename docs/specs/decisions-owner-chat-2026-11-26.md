# Owner decisions, 2026-11-26 (chat)

The owner's words are in the chat of this date; this file records them in the repository.

## 1. Fable's use is reduced

**Decision.** Fable 5.2 keeps three jobs, and everything else that used to reach it now goes to Opus 5.5 or to a citation.

- **Fable keeps**: the Product Owner pass; direction and architecture calls, and any acceptance edit that changes wording, look or direction; frozen-test rulings.
- **Opus rules the routine inline questions** — technical, placement, dependency and scope — under the same Product Owner brief, with the same log format and the same veto. It sees the same evidence; it is the model that already checks and guards the same work.
- **A question an existing approval already answers is settled by citation**, not sent, as the owner's rule of 2026-11-23 asks.
- **Rulings are batched**: one per stage, every question from the check, the implement and the review in one ask, each with a recommendation, so the ruling confirms or corrects rather than investigates. One frozen-test ruling per task stays as it is.

**Why.** Fable ran eleven times on 2026-11-26: one pass and ten inline rulings across two tasks, several of them for questions with an obvious answer in the repository. Each run blocks a lane for minutes while it reads, and the queue is the real cost — not the tokens, which the Max plan covers.

**What removes the rest at the source.**

1. A `gate:` token never appears in an acceptance row except as that item's gate; a row that mentions `gate: review` in prose makes `scripts/check-red.mjs` read the whole item as a gate. The spec-checker checks this.
2. After a Product Owner pass edits a task, the spec step re-reads the task's acceptance count, and the spec's table must match it; T4-02 gained a ninth item mid-flight and its spec still showed eight.
3. The frozen source-shape scans that set two tasks' frozen files against each other are retired by T8-26, which moves the media-URL guard to lint.

**Re-check.** If routine rulings start producing answers Fable would have reversed, say so and the split goes back.

## 2. The OpenCode Go quota is used up

**Decision.** No work goes to `opencode-go/*`. The coordinator moves to the Anthropic Max plan with the stage work. This replaces the line of `decisions-owner-chat-2026-11-25.md` §2 that gives the `opencode-go` quota to the coordinator.

**What it means.** The coordinator and every stage now share the Max plan's usage window, so the coordinator stays lean: it delegates long reads and runs heavy sessions in sequence where it can. Neon keeps its own Google budget and its one review sweep per high-risk task.
