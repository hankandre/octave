# Product Owner calls on the external design review, 2026-11-26

These are **not the owner's words**. The owner asked for a review of Octave's TV design against external
guidance; it is `docs/research/tv-design-review-2026-11-26.md`. Each numbered call below is the Product
Owner's, made under the delegation of `docs/specs/decisions-owner-chat-2026-11-25.md` (1), and written here so
each task and acceptance edit names the call it rests on. The owner can veto any of them, and a veto is final.
Each call is also logged in `tasks/product-owner-log.md`, in the third pass section of the same date.

Precedence the owner gave for design guidance: a task's acceptance and `DESIGN.md` first, then Android TV's
guidance, then the `frontend-design` skill, then `impeccable`. A conflict with Android TV's guidance comes to
the Product Owner.

Checked before deciding: the layout page's 27 dp margin and its note that most modern TVs no longer overscan;
the quality checklist's TV-OV and TV-PC rows, word for word; and the captures
`T4-04/after-password-wrong.png`, `T4-02/after-unencrypted-dialog.png` and `T8-04/after-chrome-scrubber.png`.
The drawer's spec figures were not re-measured; the review's readings of them are taken as given.

## 1. The rail keeps 16 px on all four sides (T3-40, unchanged)

T3-40's acceptance, spec and frozen tests do not change. Call 4 of
`docs/specs/decisions-product-owner-2026-11-26b.md` stands.

Why:

- The review does not overturn call 4's reason. The rail's entries already sit 16 px from the left edge by the
  approved design, and Google's own drawer puts its items inside the margin too (12 dp at the side, about 16 to
  23 dp at the top and bottom). An entry 16 px from the top is no more exposed than the same entry 16 px from
  the left. On a TV that crops, the rail was already cut.
- TV-OV asks that nothing be partially cut off. On a TV that does not crop, 16 px passes. Whether the owner's
  TV crops is unverified, and the owner will see it at once.
- T3-40 is built on its branch. It fixes three things the owner reported. The detached panel is a new look
  (a floating panel, the page showing above and below it, rounded corners) that nobody has seen on a TV, and it
  would hold those fixes back for a redraw the owner did not ask for.

Not chosen: the review's detached panel, with the collapsed Search level with the screen titles. It is kept on
the backlog. What brings it back: the owner finds Search or the account too near the edge or cut off, or the
Fire TV check (T11-08) holds Amazon's rule that a focused item sits inside the inner 90 per cent.

To judge on the TV: whether Search and the account sit too near the screen's edges, and whether the collapsed
Search icon looks misplaced above the line the screen titles start on.

## 2. Only a focused button is light (T3-41)

A primary button at rest is `surface3` with a `text1` label in weight 700. A focused primary, secondary or
danger button takes the `text1` fill with an `onLight` label, with the ring and the lift it has today. A quiet
button does not change. This replaces "Primary buttons are light, not coloured" in `DESIGN.md` 3.1.

Why: on the password step the focus is on a field, and the cream "Sign in" button is the brightest thing on
the screen (`T4-04/after-password-wrong.png`). On Google TV the light thing is where focus is: a focused
button, list item and drawer item all turn light. A viewer reads the button as selected when it is not. "One
obvious next action" holds, because a screen opens with focus on its primary action, which is then light.

What it costs: at rest a primary and a secondary differ only by the label's weight and their place. The
danger colour shows only at rest. Weight 700 on a label is new; the refiner makes it a token.

A veto restores the light primary and drops items 1 to 3 of T3-41; item 4 (call 3) stays.

## 3. One focus ring at a time under a dialog (T3-41)

No call: `DESIGN.md` section 9 already says one focus at a time. The server row behind the
unencrypted-connection dialog keeps its ring while Cancel has focus
(`T4-02/after-unencrypted-dialog.png`). It rides in T3-41 because both change how a control draws focus.

## 4. From the bare picture, select pauses and Left and Right seek (T8-27, T8-05)

While a title plays with the controls hidden and no Skip or Up Next showing: select pauses and shows the
controls with focus on Play or Pause; a single press of Left or Right seeks 10 s and shows the controls with
focus on the scrubber. Up and Down show the controls with focus on the scrubber and do not seek. Skip first,
then Play now, then this, as `DESIGN.md` 7.14 orders select today. Hold to scrub (T8-05) works whether the
controls were showing or not.

This replaces two rules of `DESIGN.md` 7.14 and T8-04's first two acceptance items as built ("an arrow shows
the controls and does not seek"; "select with the controls hidden shows them"), and so two of the T8-04 calls
of this date. Press to step and hold to scrub (D16 B) stays.

Why: the TV app quality checklist's TV-PC row, in its lowest tier, reads "While a video or audio is playing,
pressing the D-pad center button pauses the media that is playing... The D-pad left and right buttons
fast-forward and rewind". It is what every TV video app has taught the thumb, and today pausing takes two
presses. Whether Play's review enforces the row is unverified. Not chosen: leaving it until the Play release
(T11), since the owner is watching on it now and T8-05 is about to build on the same keys.

T8-27 goes before T8-05 and T8-05 depends on it, so hold to scrub is specified once, on the final keys. T8-04
is not edited: its code is merged and it is marked on what it built; T8-27 supersedes those two items.

## 5. A focused scrubber is unmistakable (T8-27)

The focused scrubber's thumb is 24 px and carries the two-tone focus ring; the track still grows. This
replaces the T8-04 call "the scrubber shows focus by its thicker track and thumb".

Why: with call 4, an arrow lands focus on the scrubber on most presses, and its only sign today is a line 4 px
thicker and a 16 px dot on a track 1,500 px long (`T8-04/after-chrome-scrubber.png`). The review's other
proposals (bolder time labels, a brighter track) are not taken: the times are already `text1`.

## 6. Captures before more look calls (T5-04)

No further look call on Home, a library or a title's page is made from the sign-in and player captures. The
owner's TV, with their own library, is the first evidence for those screens. For reviewers, T5-04's pull
request also holds captures of Home loaded with fixture artwork; a title's page gets its captures from its own
task (T7-01), as `AGENTS.md` already asks. A scope edit: it adds evidence and changes nothing on screen.

The review's verdict, "coherent and disciplined but generic", rests on screens with no artwork, and Octave's
identity is the artwork's colour, the house lights and the Signal loader. T3-35 (the loader and the mark)
keeps its place in the ui lane. The bars mark on the sign-in steps waits for T3-35 to build the mark.

## 7. Deferred and dismissed

Deferred, each on the backlog with what brings it back: the rail's detached panel (call 1); the rail's entry
size, gap and open width against Google's drawer; quiet buttons' text on the column's edge; a two-pane
sign-in with narrower fields; the faint fills behind the loading status; the bars mark on sign-in.

Dismissed: the review's point that the rail holds more than five or six entries and scrolls. One entry per
library is the owner's decision of 2026-11-20. The ring's corner gap (finding 9) is T3-40 and needs nothing
more.
