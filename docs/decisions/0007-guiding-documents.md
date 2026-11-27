# 0007. How PRODUCT.md and DESIGN.md change

- Status: Accepted by the owner, 2026-11-26.
- Note: number 0006 is held by the web client's token-boundary record, which is not yet merged.

## The owner's words

"The product MD should not change, and neither should the design MD. These should be guiding documents like North Stars. They should not be documents of historical evolution. If we need to modify our product MD or design MD, that needs to go through a whole process."

## What was asked and chosen

1. Asked how changes to the two documents should be handled, the owner chose "Use the four steps (Recommended)": "Standalone proposal, fresh review, your explicit approval, then its own pull request. Only your approval allows a change."
2. Asked how to handle TV tasks that required editing either document, the owner chose "Keep tasks moving (Recommended)": "Apply the rule to everyone, but have the Product Owner remove the document edits from task requirements. Their design behaviour stays in task briefs and decision records. You can approve proposed guide changes later in batches."
3. Told that the TV session was working on affected tasks, the owner chose "Rule now; TV handles TV tasks (Recommended)": "I merge only the general rule. Tasks already in progress can finish under the old process. I remove my 14 TV task edits, and you ask the TV session to update the other affected tasks itself."

## Decision

`PRODUCT.md` and `DESIGN.md` state what the product and its design are meant to be. A change to either goes:

1. A standalone proposal: what is wrong or missing, the exact new text, the work it affects.
2. A fresh-context review that the document still states what is intended, not how it got there.
3. The owner's explicit approval. The Product Owner may recommend a change and cannot approve it, under the delegation too.
4. A pull request for that change alone, with its record, the citations it breaks and its task's bookkeeping.

No feature, fix or process pull request changes either document.

## Tasks written before this rule

- A task already in progress when the rule merges finishes as it was written. T8-27 and T5-09 were two.
- The TV session updates the other affected tasks itself, by a Product Owner pass: each document edit leaves the acceptance and becomes a proposal, and the behaviour it recorded stays pinned. This record is the owner's approval for those acceptance edits, for each task the pass names in its log.

This file's own pull request edits no task.

## What the pass must watch

Found by the review of a first attempt at those edits:

- A task whose new strings must match `DESIGN.md` section 10 (a frozen copy test requires it, T8-17 among them) cannot pass while the table is unchanged. Its table rows need the owner's approval first, or a frozen-test ruling that keeps the test as strict.
- `scripts/design-tokens.test.ts` holds `tokens.ts` and `DESIGN.md` section 8 equal both ways. A token kept outside the tested groups loses that check, so its value needs a behaviour test of its own, and a changed value of a tested token needs the owner's approval first.

## Not decided

- What happens to the dated decision sections `DESIGN.md` already holds. Moving them is itself a change that takes the four steps.
- Whether other documents (`ARCHITECTURE.md`, `DOMAINS.md`, `WORKFLOW.md`) follow the same process. They do not today.
