# Proposal: the scrubber thumb is 24 px (T8-27)

- Status: approved by the owner, 2026-11-26 (`docs/decisions/0008-owner-answers-guiding-documents.md`, question 2).

## What is wrong

T8-27 makes the focused scrubber's thumb 24 px with the focus ring (`docs/specs/decisions-product-owner-2026-11-26c.md`, call 5). `DESIGN.md` §8 gives `scrubThumb` as 16. `scripts/design-tokens.test.ts` holds `DESIGN.md` §8 and `apps/tv/src/design/tokens.ts` equal, so neither can change alone.

## The exact new text

In `DESIGN.md` §8, Sizes row: `` `scrubThumb` 16 `` becomes `` `scrubThumb` 24 ``. In `apps/tv/src/design/tokens.ts`: `scrubThumb: 16` becomes `scrubThumb: 24`. Nothing else changes.

## What it affects

- The player's scrubber thumb draws at 24 canvas px wherever it is drawn (`apps/tv/src/player/player-scrubber.tsx` reads `sizes.scrubThumb`); the focus ring arrives with T8-27.
- T8-27 then ships with no `DESIGN.md` edit. Its other design text (7.14's keys and thumb ring, the §9 key table, its calls) becomes a proposal of its own.
- 7.14's one mention of the thumb's size changes to 24 px too, approved separately (`docs/specs/decisions-owner-chat-2026-11-27-scrub-thumb.md`).
- Not changed: 7.14 and §9 still describe the old keys. They lag the app until updated wording is approved.
- Citations broken: none. No test other than the parity test reads the value.
