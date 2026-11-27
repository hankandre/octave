# Proposal: remove the history from DESIGN.md and PRODUCT.md

- Status: approved by the owner, 2026-11-26 (`docs/decisions/0008-owner-answers-guiding-documents.md`, question 3). Revision 2 answers the decision 0007 fresh-context review.
- Scope: historical comments only. That means dated status lines, dated attributions, narration of how a rule changed, and the dated headings of the decision log.
- What does not change:
  - No rule leaves `DESIGN.md`.
  - No rule is added to or moved into another section.
  - No section is renumbered.
  - Nothing else of the reorganisation (`docs/proposals/vision-docs-restructure.md`, on an unmerged branch) is done here.

## What stays in DESIGN.md section 12

Every line of the old section 12 was checked against sections 1 to 11. A rule stated only in section 12, and still in force, stays there as a bare rule; only its date, attribution or narration is removed:

- **Look:**
  - the switch's thumb and its on and off colours;
  - the disabled label;
  - a skeleton never shimmers;
  - card spacing and `text2`;
  - the row's 96 px fading edge, with the same left margin and no fade;
  - the focused card's ring, static lift and `shadowLift`;
  - the Tabler icon set (a font through expo-font, no native module, weight 300);
  - the fade on a recycled card's cached picture.
- **Player:**
  - only working controls are drawn;
  - the icon names;
  - a film that is not 16:9 may be drawn stretched until the frame takes its shape.
- **Sign-in:**
  - Back on the first step;
  - remembered servers have no section title;
  - the unencrypted-connection choice kept for one launch;
  - the conflict-line sentence;
  - no Connect button;
  - "Loading…" while a probe runs;
  - scheme completion;
  - a failed network search shows nothing;
  - the origin chip's look;
  - the password step's failure sentence is `text1` with no icon;
  - five seconds each when a stored sign-in is checked;
  - no sign-out control yet;
  - no warning at launch over plain HTTP at home.

Section 12 opens with one line: these rules are in force and no other section states them; decisions are in `docs/decisions/` and `docs/specs/decisions-*.md`; open calls are in `docs/specs/awaiting-owner.md`.

## Each removed line of section 12, and where it is

| Old section 12 block | Each line |
|---|---|
| Carried from the desktop system | All in force in another section. One-press resume: 7.4, 7.5. Typeface: §4. Logo as title: §4, 7.3, 7.7. Skip on select: 7.14, 7.15. Ambient dwell: 7.2. 28 and 24 px: §4. Exit by the platform's rule: §6. Held select opens details: 7.5 and §9. Press and hold to scrub: 7.14. Back restores the place: §9. "Buffering…" after 500 ms: 7.14. No `text3` over video: §3.1. The D-codes are defined at tag `desktop-tauri-final`. |
| Owner decisions, 2026-11-20 | All in force in §2, §6, 7.1, 7.4, 7.12 and 7.20. The record of the decision is in `docs/decisions/0009-design-and-product-history-kept.md`. |
| Owner decisions, 2026-11-22 (look) | Kept in §12: switch, disabled label, skeleton, cards, row edge, focused card. In another section: text field border (7.19, §8), toast width (§8), played mark (7.5). Removed as status: "T3-12 and T3-18 measure the shadow's cost". Recorded in `docs/specs/T3-06.md` and `T3-08.md`. |
| From the decision inbox, 2026-11-22 | Continue watching (7.4), settings (7.18), brass (§8, 7.17), the card's menu (7.4), Settings sections (7.18), logo and loader (7.17), errors (§10). Icons: kept in §12. The evidence table is in 0009. |
| Owner decisions, 2026-11-23 | 7.5. The fade on a remounted card is kept in §12. |
| T8-04 calls | 7.14 (chrome, Back, the select keys, Play/Pause, the focus holder, the scrubber's focus, wording). Kept in §12: working controls only, icon names, the stretched picture. Removed as plan: "T8-05 keeps one condition", already in 7.14's remote keys. |
| T4-02 calls | C1 §10; C10 §9; C11 and C12 7.19. Kept in §12: C2-C9, and C1's one-launch rule. |
| T4-03 calls | C1-C3, C5, C6, C8: 7.20 and §10. C4 and C7 are superseded by T4-04, so they are not kept. |
| T4-04 calls | C1-C5 and C7-C12: 7.20 and §10. C6's sentence is in §10; its "`text1` with no icon" is kept in §12. C12's react-native-tvos detail explains a rule 7.20 states. |
| T3-40 calls | 1 and 3: §9; 2 and 5: 7.1; 4: §6. |
| T4-05 calls | Q4, Q6, Q12, Q13: 7.20. Q7's "Loading…" alone, no second try and Back: 7.20; its five seconds are kept in §12. Q10 and Q11 are kept in §12. |
| Awaiting the owner | `docs/specs/awaiting-owner.md` |

The full text of every Product Owner call stays in the spec or decision file that `docs/specs/awaiting-owner.md` links.

## Other removed historical comments

- **`DESIGN.md`:**
  - the status line and "Awaiting a TV design pass" (now in the awaiting list);
  - "and await the TV design pass" in §8's intro;
  - inline "(owner, DATE …)" attributions in 7.1, 7.4, 7.5, 7.8, the 7.14 OSD, 7.17, 7.18, §10's error rule and the "Page not available" row (each cited a decision file, which still holds it; the audio pill's date is at tag `desktop-tauri-final`);
  - 7.4's narration "as it did until now (decision D15 B)", reworded to the same rule;
  - 7.18's "placed with auto-play by the Product Owner, not by the owner", reworded to the rule ("follows the account, with auto-play");
  - 7.20's "the owner's call; the Product Owner decided them … for the owner's veto" (in the awaiting list);
  - 7.20's citation "(section 12, T4-04, C12)", repointed to `docs/specs/T4-04.md`, C12.
- **`PRODUCT.md`:**
  - the status line;
  - "(the owner, 2026-11-12)" on four sentences and "(owner decisions, 2026-11-20)", recorded in 0009;
  - "(owner, 2026-11-22, T5-01)", recorded in `docs/specs/decisions-owner-inbox-2026-11-22.md`;
  - "Decided product questions": the owner's inbox and chat files of 2026-11-22, `docs/specs/T3-21.md`, `docs/security.md` and T4-01's acceptance hold them, and the rules are in force in `DESIGN.md` 7.4, 7.18 and §10.

## Kept, and why

- **Evidence, not history:**
  - "UX audit D13 B" in §4, which cites the audit finding behind the 24 px floor;
  - the font licence check in §4 ("verified 2026-11-08", "checked 2026-11-22");
  - 7.17's "The reference is the coordinator's logo page, round 7", which names the artefact the mark is drawn from.
- **Bound to the code:** the §10 State cell "the player did not stop (…; owner decision 2026-11-19)". `packages/core/src/domain/playback-failure.ts` names that row verbatim and the frozen copy test matches it.
- **Current or planned behaviour, not history:**
  - forward-looking task notes ("T3-35 adds it to the code", "until T5-05 builds it");
  - the "As built (T8-04)" block;
  - the "owner's call" notes in §6, 7.1 and §9;
  - the Open product questions of `PRODUCT.md`.

## Citations this change breaks

- **Repointed in this change** (Product Owner pass, eighth, in `tasks/product-owner-log.md`):
  - T3-41 item 6, T4-06 item 12, T4-11 item 12, T4-12 item 6 and T5-09 item 5 asked section 12 to record their calls; they now list them in `docs/specs/awaiting-owner.md` (scope edits, for the owner's veto).
  - T8-27 item 5 now asks for a proposal and no `DESIGN.md` edit (owner, question 2).
  - T1-25 item 2 and T1-29 item 5 (seventh pass).
- **Not repointed** (closed, append-only, historical or another branch's):
  - `tasks/backlog.jsonl` line 302 (keeps PRODUCT.md's "decided product questions") and line 343 ("DESIGN.md §4, §12 decision 3"), which is append-only. The rule it cites, the Logo as the title, is in §4, 7.3 and 7.7.
  - The evidence of done tasks T3-40, T5-01, T9-01 and T9-08, which status fields hold.
  - Historical specs that cite section 12: `docs/specs/T3-08.md`, `T3-09.md`, `T3-34.md`, `T3-40.md`, `T4-02.md`, `T5-03.md`, and `docs/specs/design/full-screen-states/brief.md`. Under the 2026-11-20 and 2026-11-22 headings, their rules are in force as listed above.
  - Specs and the Product Owner log citing the old section 12 names ("T4-02 C10 in `DESIGN.md` 12" and the like). The calls are in their spec files, linked from the awaiting list.
  - Owner decision files are not edited. The owner's words are kept as written, and the rules do not allow adding a note.
  - The T8-27 branch, which edits section 12 (call blocks 4 and 5 of 2026-11-26c). That edit leaves the branch under question 2.

## Tasks and proposals filed with it

- `docs/proposals/menu-or-info.md`: `DESIGN.md` 7.5 and §9 still say Menu or Info opens the details on a Continue watching card. The owner's direction (`docs/specs/decisions-direction-2026-11-22.md` §2) says it opens the same menu. Not edited here.
