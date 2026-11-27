# Calls awaiting the owner

This is the one list of calls the owner can still veto, or has said they will judge on the TV (`docs/decisions/0008-owner-answers-guiding-documents.md`, question 3). It replaces `DESIGN.md`'s status lines and its "Awaiting the owner" list.

- **Who keeps it:** the Product Owner.
- **When a call leaves:** when the owner confirms or vetoes it. The answer goes to a decision file, and any change to `DESIGN.md` or `PRODUCT.md` goes through decision 0007.
- **What is linked, not copied:** each call. Its text stays in the file named.
- **What it covers:** every Product Owner decision in `tasks/product-owner-log.md` is open to the owner's veto. This list names the calls flagged for the owner (all made on 2026-11-26), and those that `DESIGN.md` section 12 listed. Calls marked *superseded* or *answered* stay for reference only.

## To judge on the TV

- **The token values.** They were carried over from the desktop system's TV form. T3-06 put them into code and checks them on the 1920×1080 canvas; the owner confirms them on the Shield (`DESIGN.md` section 8).
- **The look values the owner accepted on 2026-11-22 "for now, to be judged again on the Shield at the token check".**
  - **What they are:** switch, text field border, disabled label, toast width, skeleton, card spacing, the row's fading edge, the played mark, and the focused card.
  - **Where they are:** `DESIGN.md` section 8 and section 12 "Look", and `docs/specs/T3-06.md` and `docs/specs/T3-08.md`.
- **The lift and memory choice:** decision 0004, choice 2.
- **The no-link Quick Connect sentence on a loopback server:** `docs/specs/T4-03.md`, call C2.
- **The QR code at 480 canvas px**, "reasoned, not measured": `docs/specs/T4-03.md`, call C5.
- **The extra press after "Next" on the password step:** `docs/specs/T4-04.md`, call C3.
- **The rail's padding of 16 px on all four sides:** `docs/specs/decisions-product-owner-2026-11-26b.md` §4, kept by `-2026-11-26c.md` §1.
- **Up from any card landing on the hero's Resume, at the far left:** `docs/specs/decisions-product-owner-2026-11-26d.md` §3.
- **Home's rows stepping to the focused card instead of sliding (T5-09):** the log, "2026-11-27, T5-09 ruling, a row that does not scroll back from its end"; the text is in `docs/proposals/T5-09.md` §7.4. A veto brings the slide back with a one-pixel end padding, and a Left from a row's end then misses its scroll in some runs.
- **A row's last card 96 px in, with its end fade off while it has focus (T5-09):** `decisions-product-owner-2026-11-26d.md` §4; the text is in `docs/proposals/T5-09.md`.

## Open questions for the owner

- **A profile PIN (T12-01).** Also asked as question 2 of `decisions-product-owner-2026-11-26e.md` §6.
- **Recent searches (T12-05).**
- **One Home across servers** (`PRODUCT.md`, "Open product questions").
- **Other TV platforms** (`PRODUCT.md`, "Open product questions").
- **T4-06's questions:** two presses to resume with two accounts; the record T4-10 starts with; adding an account as the only way to another server (`decisions-product-owner-2026-11-26e.md` §6, questions 1, 3 and 4).

## Product Owner calls under the delegation, for the owner's veto

### Calls `DESIGN.md` listed

- **The sign-in screen with its QR code,** named as the owner's call with T1-08. Answered by the Product Owner in the T4-02, T4-03 and T4-04 calls below.
- **The countdown follows the account, with auto-play** (`DESIGN.md` 7.18).
- **A card's picture fading in over its preview.** The owner decided the preview on 2026-11-23 (`docs/specs/decisions-owner-inbox-2026-11-23b.md` §3); the fade was listed for the owner's veto.
- **T8-04's player calls:** `docs/specs/T8-04.md`, "For the owner's veto".
  - *Superseded once T8-27 merges:* "An invisible element holds focus … neither seeking nor pausing" and "The scrubber shows focus by its thicker track and thumb". `decisions-product-owner-2026-11-26c.md` §4 and §5 replace them (`docs/proposals/T8-27.md`).
- **T4-02's calls C1 to C12:** `docs/specs/T4-02.md`; C10 also in the log, "2026-11-26, T4-02 ruling, Captures".
- **T4-03's calls C1 to C8:** `docs/specs/T4-03.md`.
  - *Superseded:* C4 (opening focus on "Change server") and C7 (the password placeholder), both by T4-04 (C7 there, and the built password step).
- **T4-04's calls C1 to C12:** `docs/specs/T4-04.md`.
- **T4-05's calls Q4 to Q13:** the log, "2026-11-26, T4-05 ruling, Spec and Check"; `docs/specs/T4-05.md`.

### Calls in the decision files

- `docs/specs/decisions-product-owner-2026-11-26.md`, calls 1 to 6:
  - Home when its whole load fails;
  - a plain-HTTP name resolving outside the home network;
  - Show password;
  - Back when the player cannot stop;
  - an audio pick this device cannot play;
  - calls that edit no task.
- `decisions-product-owner-2026-11-26b.md`, calls 1 to 8 (calls 1 to 5 are the T3-40 calls `DESIGN.md` listed).
- `decisions-product-owner-2026-11-26c.md`, calls 1 to 7.
  - *T8-27 rests on:* call 4 (from the bare picture, select pauses and Left and Right seek 10 s; Skip, then Play now, stay ahead of the pause) and call 5 (the focused scrubber's thumb carries the focus ring). `DESIGN.md` 7.14 and section 9 still describe the old keys; `docs/proposals/T8-27.md` gives the new text.
- `decisions-product-owner-2026-11-26d.md`, calls 1 to 8.
  - *Superseded:* call 8's repeat sign-in, corrected by `decisions-product-owner-2026-11-26e.md` §3, B25.
- `decisions-product-owner-2026-11-26e.md`, sections 1 to 4: the split of T4-06, the conflicts, the behaviours, and the open choices O1 to O6.
- `decisions-product-owner-2026-11-26f.md`, calls 1 to 10, and its "For the owner's veto" list.
  - *Answered:* call 7 (the session-ended sentence). The owner chose the new layout (`docs/specs/decisions-owner-chat-2026-11-26-session-ended.md`).

### Calls in the log (`tasks/product-owner-log.md`)

- "2026-11-26, T3-43 ruling, Spec and Check": Up and Down from the content no longer enter the rail.
- "Product Owner pass, fourth": the calls of `decisions-product-owner-2026-11-26d.md`.
- "Product Owner pass, fifth": the calls of `decisions-product-owner-2026-11-26f.md`.
- "Product Owner pass, sixth": the new session-ended sentence.
- "Product Owner pass, seventh": the edits of T1-25 item 2 and T1-29 item 5.
- "2026-11-26, T5-09 ruling, Spec and Check": no design step for T5-09, Up into the hero kept against Android TV's nearest-element guidance, "shows no fade" met by a fade over empty space, the unanimated scroll to the top on every hero focus, and the middle card under the fade sent to the backlog.
- "2026-11-27, T5-09 ruling, a row that does not scroll back from its end": the rows' unanimated scroll, and T5-09 item 5 met by `docs/proposals/T5-09.md` (scope edit of 2026-11-27).

## Settled, no longer awaiting

- **The rail's look and entries, the posters beside it, and what Back does on Home:** approved with T1-08 on 2026-11-20 (T1-08's evidence; T1-29 item 5).
- **What Menu or Info does on a Continue watching card:** it opens the same menu as a held select (`docs/specs/decisions-direction-2026-11-22.md` §2). `DESIGN.md` 7.5 and §9 still say it opens details; `docs/proposals/menu-or-info.md` gives the new text.
