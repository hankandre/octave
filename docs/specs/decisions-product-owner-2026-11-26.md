# Product Owner calls under the delegation, 2026-11-26

These are **not the owner's words**. They are the look and wording calls the Product Owner made in the pass of
2026-11-26 under the delegation of `docs/specs/decisions-owner-chat-2026-11-25.md` (1), written here so each
acceptance edit names the call it rests on. The owner can veto any of them, and a veto is final. Each call is
also logged in `tasks/product-owner-log.md`, in the section of the same date.

Every call but the first reuses wording or a control that `DESIGN.md` already holds; the first adds one row to
the copy table from a sentence the table already uses.

## 1. Home when its whole load fails (T5-04)

When Home's whole load fails, or every one of its lists fails, Home shows the lost-connection state with Retry
focused. The sentence is "Couldn't reach {server}. Check that the server is on, then try again.", and the action
is Retry. T5-04 adds the row to `DESIGN.md` section 10 as "Home, couldn't load".

Why this sentence: it is the one `DESIGN.md` section 10 gives as its own example of an error that names the
problem and the way out, and the one the player already shows when the server is unreachable. A viewer who meets
the same failure in two places reads the same words.

## 2. A plain-HTTP name that resolves outside the home network (T4-02)

It shows the copy table's refused-plain-HTTP sentence, the same as a public plain-HTTP address. It gets no
sentence of its own.

Why: the existing sentence already says what happened and what to do (use HTTPS, or HTTP only for a private
home-network address). A second sentence would explain name resolution to a viewer who cannot act on it.

## 3. Show password on the password step (T4-04)

The password step has the "Show password" control `DESIGN.md` 7.20 (step 3) lists. It is off whenever the step
opens.

Why: the control is already in the approved sign-in design, and no task built it. A password typed with a D-pad
and never seen is the likeliest way a first sign-in fails, and until Jellyscale has Quick Connect the password is
the only way in.

## 4. Back when the player cannot stop (T8-04)

When the stop fails on Back, the player screen stays up and shows the copy table's "Couldn't stop playback" row
with its action (owner decision of 2026-11-19, `DESIGN.md` section 10).

Why: the row exists and nothing shows it; today the screen is already gone when the stop fails.

## 5. An audio pick this device cannot play (T7-05)

When the picked audio track is dropped because this device cannot play it, the player shows the copy table's
sentence for a picked audio track that was not applied: "Couldn't switch to the audio track you picked. Playing
the default track."

Why: the settled rule is that a pick never costs a direct play, so the pick is dropped; the viewer is told with
the sentence the table already has for a pick that did not hold.

## 6. Calls that edit no task

- **A Stopped report that fails on Back or at the end of a file shows nothing.** No sentence in the copy table
  is true once the viewing has ended, and the cost is a resume point at most 10 s behind.
- **Replaying a title the server marks played starts at the beginning and writes its new position over the old
  one.** That is what a viewer who presses Play on a watched title is asking for.
- **The hero is picked by rules 1 and 4 of `DESIGN.md` 7.3 at launch.** The sequel and similar-title rules stay
  in `DESIGN.md` and return from use after the release.
