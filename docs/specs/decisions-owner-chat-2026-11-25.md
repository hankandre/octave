# Owner decisions, 2026-11-25 (chat)

The owner's words are in the chat of this date; this file records them in the repository.

## 1. The Product Owner decides until dogfooding

**Decision.** Until the app is functioning and in dogfooding, the Product Owner makes the decisions:
backlog priority, scope, product direction, and the look and wording calls the rules otherwise reserve for
the owner. The owner is asked only for **user feedback on the user experience and the interface**, and only
once there is something to dogfood. The owner can veto any decision, and a veto is final.

**Why.** Decision latency is the cost: a run that parks on a wording or look question waits for one person,
and every such park stops a lane. The owner's attention is worth more once there is a product to react to than
in answering questions about screens that do not exist yet.

**What it changes.**

- `AGENTS.md`: questions of look, wording and direction go to the Product Owner like every other question;
  the owner is asked only for UX/UI feedback during dogfooding.
- `.claude/agents/product-owner.md`: the Product Owner takes those calls and logs each one.
- An acceptance edit that changes on-screen wording or copy, look, or product direction still passes
  `owner_approval`, and this file is the standing approval; the Product Owner names the call in
  `tasks/product-owner-log.md` so the owner can veto it.
- `DESIGN.md`'s "no screen task starts before the owner approves it" and its "Awaiting the owner" list are
  answered by the Product Owner until dogfooding; the entries stay listed so the owner can revisit them.
- Nothing else changes: a denied command still halts a run, a frozen test still goes to the Product Owner, and
  every Product Owner decision stays provisional.

**Ends when.** The owner says dogfooding has started, or says the delegation is over.

## 2. Model routing and budgets for this machine

**Decision.** Route by what is reachable and funded, not by the published price table alone.

- **Product Owner and judgement escalations: Fable 5.2**, through the Anthropic Max plan (`claude-agent/fable`).
  The `anthropic/*` provider is out of API credit and is not used.
- **Routine work: Sonnet 5.5** (`claude-agent/sonnet`); **mechanical work** (commit messages, PR bodies, merge
  reports, log triage, running checks): **Haiku 5.5** (`claude-agent/haiku`); **Kotlin, guardian review and
  plans: Opus 5.5** (`claude-agent/opus`).
- **Google is budgeted at $20 per 30 days, so `google/gemini-4-neon` is an escalation model only**: a large
  cross-file audit, a big diff review, a long-context sweep. At most one Neon run per task.
- **Escalation is capped per task**: at most one Fable escalation and one Neon run outside the Product Owner
  pass. A run that needs more says what the extra would buy before spending it.
- `commandcode/*` and `claude-agent/claude-*` are not usable (invalid token; the full model names are not
  exposed by that provider — its aliases are `fable`, `opus`, `sonnet`, `haiku`).

**Why.** The Max plan is a flat subscription, so Claude models cost nothing per token; the Google budget is
small and per token, so Neon is spent only where breadth beats depth. The API key path to Anthropic fails on
credit, which is why the routing names providers rather than models.

**Re-check.** When a phase starts or a budget changes, confirm each route with a one-line probe before relying
on it (`AGENTS.md`, "Re-check every dependency when a phase starts").
