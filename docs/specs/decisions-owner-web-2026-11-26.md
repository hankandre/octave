# Owner decisions, 2026-11-26: the web client

The owner's words and answers are from the chat of this date; this file records them in the repository. The plan is `docs/plans/active/017-octave-web-client.md`.

## 1. Build it

- "We are going to start creating a plan for how to make Octave the new default web client for Jellyscale."
- "The idea is that we will have a web client that you can ship with Jellyscale. And maybe there are architectural decisions that change for the web client that might not be beneficial for a TV client or an Android or mobile client."
- "I don't think we need to match Jellyfin Web one for one. This is for Jellyscale specifically. So, if we can find a better way to improve upon Jellyfin Web, then we ought to do that. [...] If there are features that we need to request from JellyScale, we can do that. I want the best possible client for every possible platform. And right now, we're focusing on TV, a different branch, and a web right now."
- Goal, set after the plan, the research and the first falsifier: "build the Octave web client using our workflow."

**What it means.** The web client is current work, beside the TV client, which another session is building. The owner approves plan 017 for implementation under `WORKFLOW.md`. It replaces the Product Owner's holds of the plan 017 pass that rested on the web client not being current work: "no T17 tasks yet" and "the web form takes no lane from T4 to T11". The web work must not take over or block the TV session's tasks, worktrees, lanes or devices.

**What it does not decide.** Decision 0006 (the browser's token boundary), which the owner accepts as a record of its own, as the plan 017 pass ruled. The pass's other rulings stand until the owner or a later pass changes them.

## 2. The web UI is plain React DOM

Asked to choose after the evaluation (`docs/research/web-ui-paths.md`), the owner chose "Plain React DOM". Before it, the owner chose to evaluate React Strict DOM first.

## 3. Jellyscale

- Asked about D-027, the owner chose "Change D-027 so Jellyscale ships Octave", then asked for a GitHub issue "so the product owner for Jellyscale can evaluate it": jellyscale-org/jellyscale#289.
- "Any JellyScale feature requests should go as issues on its GitHub board." (`AGENTS.md`)

## 4. Design

Web design work uses Anthropic's front-end design skill, with `impeccable` as its backup. `AGENTS.md` holds the rule.
