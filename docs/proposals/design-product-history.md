# Proposal: remove the history from DESIGN.md and PRODUCT.md

- Status: approved by the owner, 2026-11-26 (`docs/decisions/0008-owner-answers-guiding-documents.md`, question 3). Decision 0007's fresh-context review (its step 2) is still to run before the pull request merges.
- Scope: historical content only: dated status lines, the dated decision log, and dated attributions. No rule changes. No section is renumbered: `DESIGN.md` §12 keeps its heading as a one-line pointer. Nothing else in the reorganisation (`docs/proposals/vision-docs-restructure.md`) is done here.

## What is saved first

- `docs/decisions/0009-design-and-product-history-kept.md` holds what no other file held:
  - the owner's five decisions of 2026-11-20;
  - the Continue watching evidence table;
  - the owner's 2026-11-12 sentences that `PRODUCT.md` attributed.
- `docs/specs/awaiting-owner.md` is the one list of calls awaiting the owner. It holds:
  - the open items of `DESIGN.md`'s status lines and its "Awaiting the owner" list;
  - the look values to judge on the Shield, copied word for word;
  - every Product Owner call block of §12, copied word for word and marked as answered by the Product Owner for the owner's veto.

## Where each removed block is recorded

### DESIGN.md

| Removed | Recorded in |
|---|---|
| Status line (T1-08 draft, the owner's named calls) | T1-08's evidence (PR #226). Its open call (the sign-in screen and QR code) is in `docs/specs/awaiting-owner.md`. The rest are settled (T1-29 item 5). |
| "Awaiting a TV design pass" | `docs/specs/awaiting-owner.md`, "To judge on the TV" |
| §8 intro "and await the TV design pass" | the same |
| §12 Carried from the desktop system | Every rule lives on in §3.1, §4, §6, 7.2, 7.3, 7.5, 7.7, 7.14 and §9. The D-codes are defined in the desktop `DESIGN.md` at tag `desktop-tauri-final`. |
| §12 Owner decisions, 2026-11-20 | The rules live on in §2, §6, 7.1, 7.4, 7.12 and 7.20. The list is in 0009. |
| §12 Owner decisions, 2026-11-22 (look values) | `docs/specs/T3-06.md` and `docs/specs/T3-08.md`; the values are in §8. The list is copied word for word to `awaiting-owner.md`, because the owner will judge them on the Shield. |
| §12 From the decision inbox, 2026-11-22 | `docs/specs/decisions-owner-inbox-2026-11-22.md`; `decisions-owner-chat-2026-11-22.md` §2-§5. The rules live on in 7.4, 7.17, 7.18, §8 and §10. The Tabler font and weight rule is in `decisions-owner-chat-2026-11-22.md` §2. |
| §12 Evidence table | 0009 (it existed only here) |
| §12 Owner decisions, 2026-11-23 | `decisions-owner-inbox-2026-11-23b.md` §3; the rule lives on in 7.5. The fade's veto is in `awaiting-owner.md`. |
| §12 Product Owner calls: T8-04, T4-02, T4-03, T4-04, T3-40, T4-05 | `docs/specs/T8-04.md`, `T4-02.md`, `T4-03.md`, `T4-04.md`, `decisions-product-owner-2026-11-26b.md`, `T4-05.md` and `tasks/product-owner-log.md`. All are copied word for word to `awaiting-owner.md`. |
| §12 Awaiting the owner | `awaiting-owner.md`. Settled calls are listed there as settled. |
| Inline "(owner, DATE …)" attributions in 7.1, 7.4, 7.5, 7.8, 7.14 (OSD), 7.17, 7.18, §10's voice rules and the "Page not available" row | The decision files they cited: `decisions-owner-chat-2026-11-22.md`, `-11-24.md`, `decisions-owner-inbox-2026-11-22.md`, `-11-23b.md`. The audio pill (2026-11-16) is recorded in the desktop history at the tag. |
| "UX audit D13 B" (§4) | The desktop `DESIGN.md` at tag `desktop-tauri-final`. |
| 7.4 "as it did until now (decision D15 B)" | Reworded to the rule alone: a held select opens this menu, Details opens the details, and on other cards and the hero a held select opens the details (as in 7.5 and the §9 table). |
| 7.18 "placed with auto-play by the Product Owner, not by the owner" | Reworded to the rule: "The countdown follows the account, with auto-play." The call is in `awaiting-owner.md`. |
| 7.20 "the owner's call; the Product Owner decided them … for the owner's veto" | `awaiting-owner.md` |
| 7.20 "(section 12, T4-04, C12)" | Repointed to `docs/specs/T4-04.md`, C12 |

### PRODUCT.md

| Removed | Recorded in |
|---|---|
| Status line (T1-05 draft) | T1-05's evidence (PR #226) |
| "(the owner, 2026-11-12)" on four sentences | 0009 |
| "(owner decisions, 2026-11-20)" | 0009 |
| "(owner, 2026-11-22, T5-01)" | `decisions-owner-inbox-2026-11-22.md` |
| Decided product questions | Continue watching, settings and errors: `decisions-owner-inbox-2026-11-22.md`. The card's menu and the Settings sections: `decisions-owner-chat-2026-11-22.md` §4 and §5. The application id: `docs/specs/T3-21.md` and `docs/security.md`. `.home.arpa`: T4-01's acceptance. The rules live on in `DESIGN.md` 7.4, 7.18 and §10, and in `PRODUCT.md`'s "Better than a streaming service". |

## Left in place, and why

- `DESIGN.md` §10, the "Playback error, the player did not stop" row. Its State cell holds "owner decision 2026-11-19". `packages/core/src/domain/playback-failure.ts` names that row verbatim, and the frozen copy test matches it, so removing the date needs a code change. Left as is.
- Forward-looking task notes (for example "T3-35 adds it to the code" and "until T5-05 builds it"), the "As built (T8-04)" block, and the "owner's call" notes in §6, 7.1 and §9. They describe current or planned behaviour, not history. The reorganisation, which is still open, handles them.
- `PRODUCT.md`'s Open product questions. They are open, not history.

## Tasks

- T1-25 item 2 and T1-29 item 5 were edited by a Product Owner pass with this approval (`tasks/product-owner-log.md`, seventh pass of 2026-11-26).
- Open tasks whose acceptance asks `DESIGN.md` §12 to "say the same" are left: T3-41, T4-06, T4-11, T4-12, T5-09 and T8-27. Under decision 0007 a Product Owner pass moves those edits to proposals before each task starts.
