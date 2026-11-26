# Product Owner calls after the first session on the Shield, 2026-11-26

These are **not the owner's words**. The owner used a release build on the Shield on 2026-11-26 and gave
feedback; it is recorded below in substance only. Each numbered call is the Product Owner's, made under the
delegation of `docs/specs/decisions-owner-chat-2026-11-25.md` (1), and written here so each task and acceptance
edit names the call it rests on. The owner can veto any of them, and a veto is final. Each call is also logged
in `tasks/product-owner-log.md`, in the second pass section of the same date.

## The owner's feedback, in substance

Sign-in worked and a title played from Home against the owner's own server. Apart from the points below the app
looked acceptable; the missing title pages and Settings were expected.

- A button's focus outline seems to touch the button at the corners and leave a couple of pixels along each side.
- Holding a direction on the focused scrubber never moves more than 10 s, and neither does holding the back 10
  or forward 10 button.
- The side rail's padding is uneven: much more above and below than at the sides.
- The owner likes the bar at the left of the current rail entry.
- On some rail entries, such as Home, the focus outline is cropped on all sides. On Search it lies over Home.
  With the rail open, every entry's outline is cropped by the rail.

## 1. The focus ring follows the control's corner (T3-40)

No call: a fault. `DESIGN.md` section 8 gives the ring a 3 px offset on every side. `FocusRing` in
`apps/tv/src/design/focus-frame.tsx` converts the control's radius and both outsets from canvas px to dp, and
then adds the 6 and 7 canvas px insets to the radius unconverted. On a 1080p TV the ring's corners are 3 dp too
round, so the ring is nearest the control at the corners. T3-40 makes the gap the same at the corners as along
the sides.

## 2. A rail entry does not lift (T3-40)

A rail entry shows focus with the ring and a `surface3` fill, and never scales. This replaces the sentence of
`DESIGN.md` section 9 that keeps the rail's entries as T3-09 built them.

Why: an entry takes focus only while the rail is open, and an open entry fills the rail's width, which is what
section 9 calls a row. A lifted open entry grows 14 px a side and its ring is cut by the rail's edge; that is
the fault that call C10 of T4-02 removed from every other list. A veto restores the lift, and then the open
rail must be made wide enough to hold it.

## 3. Nothing crops a rail entry's ring, and it covers no neighbour (T3-40)

No call: `DESIGN.md` section 9, "Room for focus", already says so. The group of library entries scrolls, and its
scroll view cuts the ring on all four sides; the gap between entries is 8 px against a ring that reaches 7 px
and a lift that added more. T3-40 leaves the ring's whole reach around every entry, in the scrolling group and
at the rail's edges, and keeps a focused entry's ring off the entries above and below it.

## 4. The rail's padding is the same on all four sides (T3-40)

The entries sit 16 px from the rail's top and bottom, the same as from its sides, in place of the 54 px
title-safe inset above and below. `DESIGN.md` section 6 names the rail as the one focusable thing outside the
title-safe inset.

Why: the side value centres a 64 px target in the 96 px collapsed rail, and it cannot grow without moving the
icons when the rail opens or moving the content off the safe inset. So even padding means less above and below.
The rail already stands wholly inside the left title-safe margin by its approved design; a TV that cut off the
top 54 px would also cut off the left 96 px, the whole rail, so this adds no risk the rail does not already
carry. Not chosen: leaving it, since the owner saw it as uneven on the Shield. To judge on the Shield: whether
Search at the top and the account at the bottom now sit too near the screen's edge.

## 5. The bar on the current entry stays (T3-40)

Unchanged, as the owner likes it.

## 6. Holding the back 10 or forward 10 button scrubs, and letting go commits (T8-05)

Holding select on either button for half a second does what holding Left or Right on the scrubber does: the
picture pauses and a pending position moves in the same growing steps, with the times following it. Releasing
select commits the pending position with one seek, and playback goes on as it was before the hold. A single
press still moves exactly 10 s. T8-05 adds this to `DESIGN.md` 7.14.

Why: the owner held each button and expected it to keep going. One rule for both places means one thing to
learn. Release commits, where the scrubber waits for select, because the viewer's thumb is already on select
and has no second key to press; Back cannot be reached while select is held, so there is no cancel, and a
viewer who overshoots holds the other button. Not chosen: repeating a 10 s seek while held, which sends a seek
per step to the engine and, on a converted stream, a new request to the server each time.

## 7. T8-05 comes straight after T8-04

Hold to scrub moves ahead of the info sheet, converted streams, tracks and subtitles in the player lane. The
earlier pass of this date put it after them, on the reasoning that a viewer can live with 10 s steps for a
while. The owner's first session says otherwise: it was one of three things they raised.

## 8. T8-04's item on the native token export is dropped (T8-04)

A scope edit, not a look call, listed here for completeness: the player's chrome is React Native (decision
0003's amendment), so no native code reads a colour, size or duration, and the item cannot be met. The title
loses the word "native".
