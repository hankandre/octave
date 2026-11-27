# Owner decisions, 2026-11-26: the web client

The owner's words and answers are from the chat of this date; this file records them in the repository. The plan is `docs/plans/active/017-octave-web-client.md`.

## 1. Build it

- "We are going to start creating a plan for how to make Octave the new default web client for Jellyscale."
- "The idea is that we will have a web client that you can ship with Jellyscale. And maybe there are architectural decisions that change for the web client that might not be beneficial for a TV client or an Android or mobile client."
- "I don't think we need to match Jellyfin Web one for one. This is for Jellyscale specifically. So, if we can find a better way to improve upon Jellyfin Web, then we ought to do that. [...] If there are features that we need to request from JellyScale, we can do that. I want the best possible client for every possible platform. And right now, we're focusing on TV, a different branch, and a web right now."
- Goal, set after the plan, the research and the first falsifier: "build the Octave web client using our workflow."
- Later in the same chat: "Make sure that you're not clashing with the other client that's bringing in the other work, tree that's doing work on Octave TV client."

**What it means (interpretation, not the owner's words).** The web client is current work, beside the TV client, which another session is building. The goal above is read as approving plan 017 for implementation under `WORKFLOW.md`. That reading replaces the Product Owner's holds of the plan 017 pass that rested on the web client not being current work: "no T17 tasks yet" and "the web form takes no lane from T4 to T11". The owner's last line above is read as: the web work must not take over or block the TV session's tasks, worktrees, lanes or devices.

**What it does not decide.** Decision 0006 (the browser's token boundary), which the owner accepts as a record of its own, as the plan 017 pass ruled. The pass's other rulings stand until the owner or a later pass changes them.

## 2. The web UI is plain React DOM

Asked to choose after the evaluation (`docs/research/web-ui-paths.md`), the owner chose "Plain React DOM". Before it, the owner chose to evaluate React Strict DOM first.

## 3. Jellyscale

- Asked about D-027, the owner chose "Change D-027 so Jellyscale ships Octave", then asked for a GitHub issue "so the product owner for Jellyscale can evaluate it": jellyscale-org/jellyscale#289.
- "Any JellyScale feature requests should go as issues on its GitHub board." (`AGENTS.md`)
- As recorded in Jellyscale's own decision D-088 (2026-11-26, by the owner): "Octave is the front end. So Octave will run in the web, on a TV, and natively on device. [...] So instead of Jellyfin Web, it will ship with Octave." and "Octave will also support rendering a QR code for quick connect." Jellyscale's D-089 and D-090 then place Octave Web at `/`, with `/web/` passing the Quick Connect address to it.

## 4. Design

Web design work uses Anthropic's front-end design skill, with `impeccable` as its backup. `AGENTS.md` holds the rule.

## 5. The size limit of the task list (T17-24, T1-13, T1-21)

Asked by the coordinator, with the Product Owner's recommendation: "The task list has a 350 KB limit, which you set on Nov 22. With the web tasks it's at 346 KB, and TV progress updates would push it over within days. After that, every pull request fails. What should I do?"

- Options: "Raise it to 450 KB (Recommended)" (Web work can merge now and the TV session won't be blocked. The trade-off is less pressure to archive finished phases; that cleanup remains a later task.) / "Keep 350 KB, archive first".
- The owner chose: "Raise it to 450 KB (Recommended)".

**What it changes.** `MAX_FILE_BYTES` becomes 450,000 (T17-24). T1-13's item 5 and T1-21's item 3 name the new limit; T1-21 stays a later task. `docs/specs/decisions-prd-size-limit.md` gains a dated amendment.

## 6. Repackaging a film the browser cannot take (T17-25, T17-05, T17-22)

Asked by the coordinator, with the Product Owner's recommendation: "Most films are MKV files, which browsers generally can't play, even when they can play the video and audio inside. May Octave ask the server to repackage them without re-encoding, and re-encode only the audio when needed? TV behaviour won't change."

- Options: "Yes, amend the rule (Recommended)" (The player says "Repackaging on server, original quality" and says when audio is being converted. It still requires Jellyscale to respect the playback options (#224).) / "No, keep today's rule".
- The owner chose: "Yes, amend the rule (Recommended)".

**What it covers, and no more.** Decision 0002, invariant I1 and `ARCHITECTURE.md` §3 rule 5 are amended so that a device which decodes a source's streams but cannot take its container may ask the server to copy them into one it takes, and a device may ask that only the stream it cannot decode be re-encoded. Each is shown to the viewer. A device that names no containers, as the TV, sends exactly today's requests. T17-25 writes the amendment; T17-22 uses it and still waits for jellyscale-org/jellyscale#224; T17-05 keeps today's rule until T17-25 merges.

## 7. PRODUCT.md and DESIGN.md change only through a process of their own

**The owner's words:** "The product MD should not change, and neither should the design MD. These should be guiding documents like North Stars. They should not be documents of historical evolution. If we need to modify our product MD or design MD, that needs to go through a whole process."

**What it means for the web work.** No web task edits either file. T17-03 and T17-25, whose acceptance does, are blocked until the owner sets the process and a Product Owner pass changes them.


## 8. The `web` lane in WORKFLOW.md

**Asked:** "Do you approve adding the `web` task lane to the lane list in WORKFLOW.md as part of PR #368?", after the rule on guiding documents came to cover `WORKFLOW.md` (`AGENTS.md`, "Guiding documents"). **The owner chose:** "Approve the one-line change".

**What it covers.** Adding `web` to the lane names in the one "Lanes" sentence of `WORKFLOW.md`, and nothing else in that file. It cascades to `LANES` in `scripts/task.mjs` and its copy in `.claude/workflows/task.js`, and to the two lane tables in `scripts/task-lanes.test.ts` and `.claude/workflows/task-lanes.test.mjs`. No TV lane changes.

**§7 widened.** `DOMAINS.md`, `ARCHITECTURE.md` and `WORKFLOW.md` are guiding documents too: a web task changes none of them without the owner's explicit approval, and web-specific rules go in guides under `docs/web/`.
