# T5-09: proposed `DESIGN.md` text (held, not approved)

**Status: not approved.** On 2026-11-27, during T5-09's implementation, the coordinator relayed an owner update: agents do not edit
top-level documents. It overrides the spec's item 5, its spec check and the Product Owner ruling. `DESIGN.md` is unchanged on
this branch. The text below is a proposal for the owner to consider later. Task item 5 ("`DESIGN.md` sections 7.3, 7.4 and 12
say the same in the same PR") is therefore not met.

The rules come from Product Owner calls 3 and 4 of `docs/specs/decisions-product-owner-2026-11-26d.md`, which are provisional.

## 1. §7.3 Hero

Replace the bullet:

> - Focus opens on Resume. The title the hero shows is not repeated as the first card of the row below it.

with:

> - Focus opens on Resume. The title the hero shows is not repeated as the first card of the row below it.
> - Up from any card of the first row lands on the primary action (More info when the hero has no primary), and Home scrolls to its top, so the title, facts and overview are in view. Right on the hero's last button does nothing: focus stays on it and nothing scrolls.

## 2. §7.4 Home and its rows

In the bullet that starts "A row is a title", replace the two sentences:

> Up and Down move to the adjacent row, to the card nearest by horizontal centre. The focused card keeps 96 px from the edge.

with:

> Up and Down move to the adjacent row, to the card nearest by horizontal centre; Up from the first row into the hero is the exception (7.3). The focused card keeps 96 px from the edge, the last card too: a row ends 96 px after its last card's box, and the row's end fade is off while that card has focus.

## 3. §9 Interaction rules, "Focus model"

The spec places the row rule here too. Replace:

> - Rows and grids move focus within themselves with Left and Right; Up and Down across rows go to the nearest item by horizontal centre. Left from the first item of a screen opens the rail; Right from the rail returns to where focus was.

with:

> - Rows and grids move focus within themselves with Left and Right; Up and Down across rows go to the nearest item by horizontal centre. Up into Home's hero is the exception: it lands on the hero's primary action (7.3). Left from the first item of a screen opens the rail; Right from the rail returns to where focus was.

and replace:

> - Focus is never hidden: rows scroll the focused card to at least 96 px from any edge, and the rail never covers it.

with:

> - Focus is never hidden: rows scroll the focused card to at least 96 px from any edge, and the rail never covers it. A row ends 96 px after its last card, and its end fade is off while that card has focus.

## 4. §12 Decisions

The owner's 2026-11-22 fading-edge bullet stays as written. Add this heading before "### Awaiting the owner":

> ### Product Owner calls, 2026-11-26d (T5-09)
>
> These are the Product Owner's calls under the delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1), not the owner's words. Each is provisional: the owner can veto it. The reasons are in `docs/specs/decisions-product-owner-2026-11-26d.md`, whose numbers these are.
>
> - **3. Up into the hero.** Up from any card of Home's first row lands on the hero's primary action (More info when the hero has no primary), and Home scrolls to its top, so the title, facts and overview are on screen. Right on the hero's last button does nothing. To judge on the TV: whether Up from a card far to the right should land on Resume, at the far left. A veto restores nearest centre; the scroll to the top and the Right edge stay.
> - **4. A row's last card clears the fade.** A row ends 96 px after its last card's box, and the end fade is off while that card has focus. The owner's right-edge fade of 2026-11-22 stays everywhere else.

## Known limits of the 96 px sentence

The emulator did not always keep a focused card 96 px from a row's edge when moving back from the end. The cases are in
`tasks/backlog.jsonl` (lines sourced "T5-09 milestone 3") and in the pull request. Check them before adopting "keeps 96 px" as
written.
