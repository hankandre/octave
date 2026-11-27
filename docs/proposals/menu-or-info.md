# Proposal: Menu or Info on a Continue watching card opens the card's menu

- Status: filed for the owner, 2026-11-27. Under `AGENTS.md`'s rule for guiding documents, the owner's recorded direction is followed while this proposal is open.

## What is wrong

The owner answered on 2026-11-22 (`docs/specs/decisions-direction-2026-11-22.md` §2): "**Menu or Info** on a Continue watching card opens the same short menu as holding select (one menu, two ways to reach it; remotes without a Menu key still have the hold)". `DESIGN.md` still says that Menu or Info opens the details:

- 7.5, the `thumb` row of the card table: "Menu or Info, where the remote has one, opens details";
- section 9, the remote-keys table: "| Continue watching card | Menu or Info | Open details |".

## The exact new text

- **7.5, `thumb` row, Select cell.** Replace "Menu or Info, where the remote has one, opens details" with "Menu or Info, where the remote has one, opens the same menu".
- **Section 9, that row.** "| Continue watching card | Menu or Info | Open the card's menu (7.4; from T5-05) |".

The same direction file also says the menu ships first without Remove, which is added when Jellyscale supports it (Jellyscale #233). `DESIGN.md` 7.4 already says Remove waits for #233; no text change is proposed for it.

## What it affects

- T5-05 builds the menu, and its acceptance item 4 already asks `DESIGN.md` 7.5 and section 9 to say this.
- No test reads these rows.
