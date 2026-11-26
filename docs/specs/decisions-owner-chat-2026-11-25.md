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

- **The Anthropic Max plan carries the work.** It is a flat subscription, so its models cost nothing per
  token; its limit is a usage window. **Sonnet 5.5** (`claude-agent/sonnet`) is the default for tests,
  implementation and review; **Opus 5.5** (`claude-agent/opus`) for Kotlin, native work, guardian review and
  plans; **Haiku 5.5** (`claude-agent/haiku`) for mechanical work; **Fable 5.2** (`claude-agent/fable`) for the
  Product Owner and judgement escalations.
- **The `opencode-go` quota is finite and belongs to the coordinator.** The main session runs on it and stage
  work does not: no Argon, Kimi or Grok for a stage when a Max-plan model can do it.
- **The free tiers carry grunt work.** `opencode/*` (OpenCode Zen) and `nvidia/*` answer at zero cost
  (`opencode/deepseek-v4.1-flash-free`, `opencode/big-pickle` and `nvidia/stepfun-ai/step-5-preview` were
  confirmed by probe); use them for mechanical work that needs no judgement.
- **Google is budgeted at $20 per 30 days, so `google/gemini-4-neon` is an escalation model only**: a large
  cross-file audit, a big diff review, a long-context sweep. At most one Neon run per task.
- **Escalation is capped per task**: at most one Fable escalation and one Neon run outside the Product Owner
  pass. A run that needs more says what the extra would buy before spending it.
- **State-of-the-art judgement models make the decisions**: Fable 5.2, or Neon where breadth beats depth.
  Implementation goes to the strongest model that does it well (Opus 5.5), down to Sonnet 5.5 for cost.
- `anthropic/*`, `commandcode/*` and the full `claude-agent/claude-*` names are not usable (no API credit,
  invalid token, and the provider exposes only the aliases `fable`, `opus`, `sonnet`, `haiku`).

**Why.** The Max plan is flat, so Claude models cost nothing at the margin while the `opencode-go` quota and
the Google budget are both finite; spending a finite bucket where a flat-plan model is at least as good buys
nothing. The exception is the coordinator, which the owner keeps on `opencode-go` so the Max plan's usage
window stays for the work.

**Re-check.** When a phase starts or a budget changes, confirm each route with a one-line probe before relying
on it (`AGENTS.md`, "Re-check every dependency when a phase starts").
