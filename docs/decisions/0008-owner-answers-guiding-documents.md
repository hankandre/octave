# 0008. The owner's answers on reorganising the guiding documents

- Status: the owner's answers of 2026-11-26, recorded as given. Approval file for T8-27, T1-25 and T1-29 where this record says so, and for the two changes named under question 2 and question 3.
- Context: `docs/proposals/vision-docs-restructure.md` (revision 2) put four questions to the owner. The coordinator condensed them; the questions below are the condensed wording the owner saw.

## The owner's answer, verbatim

"See, I don't know what the decision is that I'm supposed to make for your first point. For the second point, sure, I'm fine with the playback control update and a small PR and the trade-off that comes with it. Please do remove historical comments in the design of MD and product of MD, which I think answers your third point. And in terms of what's shared on your fourth point between web and TV, what we want is a common design system, so I don't know exactly if there's a way for us to use similar tokens between each client, but that would be ideal."

## Question by question

### 1. The reorganisation and decision 0007

Asked: "Should we go ahead with this reorganisation? First, you'd separately approve an update to our earlier approval rule (decision 0007), so it matches your new rule for all five documents."

Answer: not given. The owner did not know what decision was being asked.

Recorded as: **open**. The reorganisation does not start, and decision 0007 is not amended, until the owner answers a clearer question.

### 2. Releasing the new playback controls (T8-27)

Asked: "How should we release the new playback controls? I recommend a small pull request that makes the timeline handle larger (16 to 24 pixels), changing only that value in DESIGN.md and the app together. Then the playback changes can ship without any other edits to that document. Trade-off: until you approve updated wording, DESIGN.md will describe the old controls..."

Answer: "sure, I'm fine with the playback control update and a small PR and the trade-off that comes with it."

Recorded as: **approved**. The owner approves:

- One pull request that changes `scrubThumb` from 16 to 24 in `DESIGN.md` §8 and `apps/tv/src/design/tokens.ts`, and nothing else in `DESIGN.md`.
- T8-27 shipping with no `DESIGN.md` edit.
- `DESIGN.md` describing the old controls until updated wording is approved.

### 3. Removing history from DESIGN.md and PRODUCT.md

Asked: "May we remove history from DESIGN.md and PRODUCT.md? ... What we'd keep: your five early design decisions and the evidence comparing options for Continue watching would move to a new decision record. Choices you can still veto or need to try on the TV would go in one list at docs/specs/awaiting-owner.md."

Answer: "Please do remove historical comments in the design of MD and product of MD, which I think answers your third point."

Recorded as: **approved**, on the terms the question stated:

- Historical content is removed from `DESIGN.md` and `PRODUCT.md`.
- What exists nowhere else is kept in a new decision record.
- The calls still awaiting the owner's veto or judgement go in one list at `docs/specs/awaiting-owner.md`.

What this record does not say: it approves no other change to either document. Each removal still goes through decision 0007 as its own pull request.

Two task conflicts follow from this answer. This is the Product Owner's reading, not the owner's words:

- **T1-25 item 2** keeps `PRODUCT.md`'s decided product questions. Removing them as history overrides that item.
- **T1-29 item 5** keeps the open calls in `DESIGN.md`'s Awaiting the owner list. The list moves to `docs/specs/awaiting-owner.md`.

### 4. What is shared between the web and the TV

Asked: what is shared between the clients and what is TV only, with a proposed split.

Answer: "what we want is a common design system, so I don't know exactly if there's a way for us to use similar tokens between each client, but that would be ideal."

Recorded as: **a goal, not an approval of the proposed list**. The owner's goal is a common design system for both clients, ideally with tokens shared between them. The specific split into shared and TV-only items is not approved.
