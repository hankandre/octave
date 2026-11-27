# Product Owner calls, 2026-11-26 (f): full-screen messages

These are the Product Owner's calls under the delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1), not the owner's words. Each is provisional: the owner can veto it. The owner's own approval, of Option A's layout and the words in the brief's section 4 table, is `docs/specs/decisions-owner-chat-2026-11-26-full-screen-states.md`; nothing here widens it. The design is `docs/specs/design/full-screen-states/brief.md` (commit b67d0ffd). Made on Opus.

## 1. Two tasks, the shipped launch screens first

- **T4-11** builds the shared pattern and moves the two screens the owner meets at every launch onto it: loading and the couldn't-check screen (brief section 7, items 1 and 2).
- **T4-12** moves Quick Connect's loading and failures and the not-found state onto it, and retires the old `Notice` and `EmptyState` layouts (items 3 and 4).
- **Playback failure** (item 5) goes to T8-17, layout and words together, not to T4-11. Why: the brief's layout part of item 5 needs the title's backdrop and title (`DESIGN.md` 7.16), which T8-17 already draws for refusals, and the playback copy lives in the core with a frozen test that reads `DESIGN.md` 10 word for word (T8-25). Doing the layout and the words in two tasks would touch the same screen and the same rows twice.
- **Order in the `ui` lane:** T3-43, T5-09, T4-11, T4-12, T4-06. T5-09 stays ahead: it mends Home's focus, seen on every visit, and is next; the couldn't-check screen shows only when the server is off. T4-11 and T4-12 both go before T4-06, as the owner was told ("prioritise it before account selection"), and T4-06 depends on T4-11 so its failed switch is built once, on the new pattern.

## 2. The brief's open choices

| # | Call | Why |
|---|---|---|
| P1 | A | The owner's approval. |
| P2 | Fixed headings, name below | The owner's approval (the table's headings). |
| P3 | No "You're still signed in." | It makes a second sentence (M4). Back on the backlog as a later: dogfooding shows a viewer thinking they were signed out. |
| P4 | Keep "Try again" second on a redirect at launch and on a switch; Quick Connect's redirect keeps "Change server" alone | The table's order, approved. The server's owner may fix the redirect; Quick Connect's rule is T4-03's. |
| P5 | No minimum hold of the loading screen now | Judge on the TV first; a later on the backlog. |
| P6 | No delay before the loading screen | It shows at once today, and the frozen T4-05 test expects that. |
| P7 | Show the server while loading where it is already known: after "Try again" and on a switch, the address. At the very first launch frame no server line, until T4-10's saved list is read before the restore | The address arrives only with the restore's answer today (`packages/core/src/jellyfin/restore-session.ts`, `restoreSession` returns one outcome); splitting that call is T4-10's change, not T4-11's. The server slot's fixed top means its appearing moves nothing (M17). |

## 3. The server name

- At launch and on a switch, no server name is saved today: the stored record and the `unavailable` outcome carry only the address. T4-11 and T4-06 show the address alone in the server place (mockup 04). The name comes with T4-10's saved list, the one source for it; T4-11 does not take the name from a probe that answered, so launch and switch never disagree about where the name comes from.
- Quick Connect and Home already hold the server's name from the probe (`connection.name`, `serverName` in the signed-in parts): T4-12 and T5-04 show name and address.

## 4. Quick Connect's loading keeps its buttons

Before the code, the step shows the full-screen loading (the loader, "Loading…" as the heading, the server) with "Use a password" and "Change server" in the action row, focusable, as `DESIGN.md` 7.20 and the frozen T4-03 test ("while the code loads … Change server holds focus") ask today. This departs from M18 on this one screen: the viewer chose this step and may leave it without waiting. The brief's section 6 says "As built" for Quick Connect.

## 5. Change server becomes a secondary button

On these screens every action after the primary is secondary (brief section 3, the approved layout), so "Change server" is no longer quiet there. It stays quiet on the server and password steps, which are forms and outside the pattern.

## 6. The playback server-error sentence

On the full screen the server-error sentence is "The server had a problem starting playback, so try again in a moment." (the brief's proposal under its table, which the owner's approval does not cover). It holds no name, as M4 asks. T8-17 changes it with the core copy and `DESIGN.md` 10 together.

## 7. The session-ended sentence keeps the owner's words

"Your session on {server} has ended. Sign in again to keep watching." is the owner's own wording of 2026-11-23, pinned by a frozen T8-25 test. It keeps `{server}` against M4 until the owner says otherwise; it is asked of the owner below.

**Answered 2026-11-26:** the owner chose the new layout (`docs/specs/decisions-owner-chat-2026-11-26-session-ended.md`). The sentence becomes "Your session has ended. Sign in again to keep watching.", with the server on the line below; the wording is the Product Owner's, for the owner's veto. T8-17 changes it.

## 8. Rail and Back on the new screens

Where a rail exists (not-found, Home), Left from the first action opens it (M11), and Back does what the screen does today (brief section 6). The full-screen block is centred on the screen, not on the space beside the rail.

## 9. Frozen tests that will collide

Probed with the manifests (`docs/specs/*.tests.json`). The task's test-writer does not edit them; the Product Owner rules on them at the task's milestone 0, changing only what contradicts the approved design, as for T3-42.

| Test | Frozen by | What contradicts the design | Task |
|---|---|---|---|
| `apps/tv/src/app-root-restore.test.tsx` | T4-05 | The whole sentence with the address is the heading, in `text1`; the redirect row expects "Try again" first and focused | T4-11 |
| `apps/tv/src/sign-in/quick-connect-step.test.tsx` | T4-03 | The unreachable sentence holds the address; the redirect and other sentences are the old words; the heading "Approve this sign-in on your phone" alongside a failure; "Loading…" as a status line | T4-12 |
| `apps/tv/src/sign-in/test-support/quick-connect-doubles.tsx` | T4-03 | Its `COPY` holds the old failure strings | T4-12 |
| `packages/core/src/domain/playback-failure-copy.test.ts` | T8-25 | None if `DESIGN.md` 10 and the core copy change together; it pins the session-ended row verbatim (call 7) | T8-17 |

Not colliding, checked:

- `apps/tv/src/sign-in/test-support/sign-in-doubles.tsx` (T4-02): its `SENTENCES` serve the server step, which keeps its inline words; T4-11 brings its own strings and leaves this file alone.
- `apps/tv/src/shell/app-shell.test.tsx` and `back.test.tsx` (T3-09): pin the not-found testIDs, Go home's focus and Back; T4-12 keeps those testIDs.
- `apps/tv/src/signed-in/signed-in-play-guard.test.tsx` asserts the server-error sentence with the name; no manifest lists it, so T8-17 updates it as an ordinary test.
- `apps/tv/src/shell/not-found-screen.test.tsx`: no manifest lists it.
- No test asserts "What you can do".

## 10. Other tasks

- **T7-01**'s item-gone state uses the pattern: it gains a dependency on T4-11. T6-02's library-not-available state follows `DESIGN.md` 7.16, which T4-11 rewrites; no edit, since T6-02 reaches it through the document.
- **T3-35** puts the Signal loader in the mark box later; its full form must fit 96 high. No edit: T3-35 already replaces the ring wherever `DESIGN.md` shows a loader.
- **T3-41**: an unfocused primary still looks focused (mockup 05) until it lands. No edit.

## For the owner's veto

- The order: T5-09 before the new screens.
- Quick Connect's loading keeps two buttons (call 4).
- No server line on the first launch frame until T4-10 (call 2, P7).
- The playback server-error sentence (call 6).
- The session-ended sentence keeps the server's name (call 7).
