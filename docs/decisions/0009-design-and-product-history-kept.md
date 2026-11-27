# 0009. Decisions kept when DESIGN.md and PRODUCT.md dropped their history

- Status: a record, 2026-11-26. It holds what `DESIGN.md` and `PRODUCT.md` recorded and no other file does, when their historical content was removed with the owner's approval (`docs/decisions/0008-owner-answers-guiding-documents.md`, question 3). It changes no rule.

## The owner's design decisions of 2026-11-20

From `DESIGN.md` section 12, "Owner decisions, 2026-11-20". The rules themselves stay in `DESIGN.md` (sections 2, 6, 7.1, 7.4, 7.12 and 7.20); this is the record that the owner made them. T1-08's evidence records the approval ("Owner approved the DESIGN.md wording on 2026-11-20; landed in PR #226").

- The TV is the reference form.
- Navigation is a collapsed side rail.
- Home has one Recently added row of movies and shows, with episodes grouped by series.
- Libraries open on the full grid, with a remembered sort that includes "Newest added", and a letter rail when sorted A to Z.
- Sign-in is by QR code and Quick Connect, so single sign-on works.

`PRODUCT.md` also named the owner's decisions of 2026-11-20 as the source of the client order: Android TV first, Apple TV kept possible, then phones and tablets, then the desktop.

## The evidence for the Continue watching and settings decisions of 2026-11-22

From `DESIGN.md` section 12, "Owner decisions, 2026-11-22, from the decision inbox". The owner's words are in `docs/specs/decisions-owner-inbox-2026-11-22.md`; this table compared the options:

What the evidence says for each option, for the decisions that had options:

| Decision | Chosen | Not chosen | What the evidence says |
|---|---|---|---|
| What Remove means | Hide the title, keep its progress | Reset its progress | Removal is the second most wanted feature on Jellyfin's tracker (1,740 votes, `docs/research/streaming-ux-gripes.md` 2.4). Resetting is the workaround that works today, "at the cost of the resume position" (`docs/research/discovery-api.md:75`). Hiding needs the server: Jellyscale #233 is open, and Jellyfin's "exclude from resume" proposal has no release (`streaming-ux-gripes.md:81`). |
| Where Remove lives | A short menu on a held select | The title's page | No measurement compares the two. A menu on the card removes a title without leaving the row; Netflix brought removal to every device in 2022 (`streaming-ux-gripes.md:246`), and where its control sits is unverified here. It changes what a held select does on these cards; the owner has since said what the menu holds (7.4). |
| Whether titles leave by themselves | After 90 days, changeable per account, Never included | Keep everything by default | That Netflix ranks the row by recency supports ageing titles out, and "no data says where the cut should be" (`streaming-ux-gripes.md:246`); the desktop rule of two weeks had no evidence (`PRODUCT.md` before this decision). 90 days is the owner's choice, not a measured value. |
| Where per-account settings are stored | The server's display preferences | On the device, keyed by account | "Settings that follow the account" has 260 votes on Jellyfin's tracker, and both servers are said to implement the record (`docs/research/streaming-wishlist.md:250`); that the pinned Jellyscale keeps what Octave writes is unverified until the task that builds it checks. |

## The owner's words of 2026-11-12 quoted in PRODUCT.md

`PRODUCT.md` attributed these to the owner, 2026-11-12. The sentences stay in `PRODUCT.md` without the attribution:

- "It aims to give **the best possible watching experience**: it should feel like a streaming service such as Netflix, on your own library, **without having to finagle with the client**."
- "A personal library has no reason to keep anyone watching, and nothing in it expires."
- Not for: "Music, audiobooks, and photos. Octave is a video client."
- Not for: "Live TV and DVR. Out of scope."
