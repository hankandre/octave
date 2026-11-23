# Direction decisions, 2026-11-22

The owner's decisions of 2026-11-22, relayed by the coordinator. The Product Owner applies them at its next pass and logs how in `tasks/product-owner-log.md`; the placement and order are the Product Owner's.

## 1. The product comes first; hardening is one part of the work

The owner's words: "make sure that hardening is one aspect of what we do, but not the primary purpose of the software."

Octave's purpose is the one in `PRODUCT.md`: a TV client that plays the original file whenever the device can and shows every conversion. Hardening protects that purpose; it does not replace it. An independent review on 2026-11-22 found that hardening was outrunning the product: phase T3 had reached task 38 and the real-TV gate list had been re-judged four times in two days, while the slice's rows (T3-08) and first playback (T8-03) were still todo (`tasks/product-owner-log.md`, the slice plan at the section that defines it and the gate sections after it).

How the work runs from now on:

- **The slice comes first.** Until T8-03 item 7 passes (from Home, one press on Resume reaches the first frame), the coordinator starts the slice's lanes first and the Product Owner orders each lane so its next ready task is a slice task where one is ready.
- **Hardening runs beside the product, not ahead of it.** A hardening task takes a lane only when no slice task is ready in that lane, or in a lane the slice does not use.
- **The owner's review rule stays the bar for gates** (`docs/specs/decisions-process.md`): only a finding that opens a path into the home network or leaks local information gates a real-TV install. Other findings go to the one hardening task per phase. The Product Owner does not add a new real-TV gate without naming which of the two holds.
- **The direction review** (`docs/specs/decisions-model-budget-2026-11-22.md`, proposal C) reports, each time, how many of the tasks merged since the last review moved the product forward and how many were hardening or process.

## 2. The Menu or Info key on a Continue watching card (T5-05)

Answered by the owner on the decisions page on 2026-11-22.

- **Menu or Info** on a Continue watching card opens the same short menu as holding select (one menu, two ways to reach it; remotes without a Menu key still have the hold).
- **Ship the menu now without Remove.** Mark as watched, Go to series and Details ship first; Remove is added when Jellyscale supports it (Jellyscale #233).

## 3. From the same review (backlog lines)

- A pull request that changes a security rule opens with one plain sentence saying what, if anything, got looser, so the owner can skim it.
- Frozen-test fixtures have been corrected four times in a few days (T3-26, T8-22 twice, the T3-08 helper). Under `AGENTS.md` (propose a check after the second repeat), the test-writer step gets a check of each fixture against the spec before tests are frozen.

## 4. The Product Owner decides what Octave does (amendment, 2026-11-22)

The owner's words: "The product owner does not need to necessarily reorder work. They can determine what's on the backlog versus what we do. And it can also dismiss work and say, that is not something that we need to do." And: "The goal of the product owner is also to make sure that we're staying on track and not getting sidetracked with things that are important but maybe not primary."

- The Product Owner's job is deciding scope, not arranging a queue. Each backlog entry is **do**, **later** or **dismiss**, and a todo task that no longer earns its place is dropped with a reason.
- Reordering is the exception: only when a lane would build something secondary before the product.
- Until the backlog can mark an entry dismissed (backlog line of the same date), each dismissal and later is logged in `tasks/product-owner-log.md` and treated as decided by later passes.
