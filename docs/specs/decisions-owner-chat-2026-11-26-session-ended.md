# Owner decision, 2026-11-26 (chat): the session-ended message follows the new layout

The owner's words are in the chat of this date; this file records them in the repository. It answers the question left open by `docs/specs/decisions-product-owner-2026-11-26f.md` call 7, and adds to `docs/specs/decisions-owner-chat-2026-11-26-full-screen-states.md`, which did not cover the session-ended row.

## The question asked

The coordinator asked, in full:

> "I still need your answer on one thing, though it isn't blocking anything. The message shown when a session ends uses your own wording, which includes the server name: \"Your session on {server} has ended…\". The new error screens show the server name below the message instead. Should this one stay as it is, or follow the new layout? It stays as it is unless you say otherwise."

## The owner's answer, in full

> "In terms of the decision for me, the new layout."

## What it covers

- The session-ended playback failure takes the full-screen pattern's layout like every other playback failure: the server's name leaves the sentence and shows on the server line below it.

## What it does not cover

- The replacement sentence. The owner did not dictate one. The Product Owner's call, under the delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1) and open to the owner's veto, is the smallest rewording of the owner's sentence, dropping only "on {server}":
  - Was: "Your session on {server} has ended. Sign in again to keep watching."
  - Now: "Your session has ended. Sign in again to keep watching."
- The title "Playback stopped" and the actions "Sign in, Back to details" are unchanged.

## Tasks this approval names

- **T8-17**: playback failures take the pattern; session-ended now reads "Your session has ended. Sign in again to keep watching." with the server on the line below. `DESIGN.md` 10 and the core copy change together in T8-17, because the frozen T8-25 test `packages/core/src/domain/playback-failure-copy.test.ts` compares the two verbatim and pins the old sentence (line 66); the Product Owner rules on that test at T8-17's milestone 0.
