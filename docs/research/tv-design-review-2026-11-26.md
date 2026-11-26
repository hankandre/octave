# Octave TV design review, 2026-11-26

Review only: no repository was changed, no device or emulator command was run, and none of the impeccable scripts were run. Searches and fetches used generic terms only.

**Units.** On the Shield's 960×540 dp window, one canvas px (DESIGN §6) is 0.5 dp. In this report "cv" means canvas px.

**Evidence base.** The committed captures are sign-in (T4-02, T4-03, T4-04) and the player (T8-03, T8-04). **None of them shows Home, Library, Detail, the rail, or any artwork.** Findings on those screens rest on DESIGN.md and the T3-40 spec, not on pixels.

**Sources read** (fetched 2026-11-26 unless marked):
- G-LAY: https://developer.android.com/design/ui/tv/guides/styles/layouts
- G-NAV: https://developer.android.com/design/ui/tv/guides/components/navigation-drawer, plus its spec figures `spec-width.webp`, `spec-padding.webp`, `nav-item-spec.webp` (same path, `/static/design/ui/tv/guides/components/images/navigation-drawer/`)
- G-FOC: https://developer.android.com/design/ui/tv/guides/styles/focus-system
- G-BTN: https://developer.android.com/design/ui/tv/guides/components/buttons, plus `button-states.webp` and `button-specs.webp`
- G-LIST: https://developer.android.com/design/ui/tv/guides/components/lists, plus `list-item-states.webp`
- G-CARD: https://developer.android.com/design/ui/tv/guides/components/cards
- G-IMM: https://developer.android.com/design/ui/tv/guides/components/immersive-list
- G-TYPE: https://developer.android.com/design/ui/tv/guides/styles/typography
- G-COL: https://developer.android.com/design/ui/tv/guides/styles/color-system
- G-QC: https://developer.android.com/docs/quality-guidelines/tv-app-quality
- A-LAY: https://developer.apple.com/design/human-interface-guidelines/layout (read through its JSON at `developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json`)
- A-FOC: https://developer.apple.com/design/human-interface-guidelines/focus-and-selection (read the same way)
- AMZ: https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html
- FD: `~/.claude/skills/frontend-design/SKILL.md`
- IMP: `~/.claude/skills/impeccable/reference/critique.md` (its heuristics lens only) and `android.md`

Unverified, because the source could not be read or has no such page:
- Google publishes no TV player or playback design page in the current TV guides index; I found none.
- The guessed URLs `/foundations/focus` and `/foundations/focus-system` return 404.
- The numeric values in Google's TV type scale are only in an image, `type-scale.webp`, which I did not read.

---

## 1. The rail's top and bottom padding

### The numbers

- **The overscan margin is 27 dp.** G-LAY says: "position the elements with a 5% margin of 48dp on the left and right sides, and 27dp on the top and bottom".
  - The same page then contradicts itself twice. It says "540 * ~5% = 27dp round off to 24dp", and "use a 5% margin layout (58dp on the sides and 28dp on the top and bottom edges)".
  - It also notes: "Most modern TVs no longer have overscan issues."
  - Octave's `safeY` of 54 cv is 27 dp, so it matches the primary figure.
- **T3-40 places the entries 8 dp from the edges.** Its 16 cv of rail padding is 8 dp.
  - Search's box spans 8–40 dp from the top of the screen. Its ring reaches 3.5 dp further out (7 cv), to 4.5 dp from the edge.
  - So the whole Search entry, ring included, and the top 19 dp of its 32 dp box lie inside the 27 dp margin. The account entry is the mirror case at the bottom.

### What Google's navigation drawer itself specifies

The page text gives only the anatomy. The numbers below are read from the spec figures, which are drawn at 2 px per dp: the 540 dp drawer is 1,077 px tall in `spec-width.webp`.

| Drawer element | Google spec | Octave (T3-40) |
|---|---|---|
| Collapsed width | 40–80 dp ("min 40dp / max 80dp") | 48 dp (96 cv) |
| Expanded width | 220–280 dp | **200 dp** (400 cv), below Google's minimum |
| Item size | 48 dp tall; collapsed 56×48 (16 + 24 icon + 16) | **32×32 dp** (64 cv) |
| Side padding | 12 dp | 8 dp |
| Gap between items | 12 dp | 4 dp (8 cv); a ring then clears the next entry by 0.5 dp |
| Top and bottom sections | 80 dp each, item centred in it | n/a |
| First and last item from the screen edge | Avatar about 23 dp from the top; the bottom 48 dp item is (80 − 48) / 2 = **16 dp** from the bottom | 8 dp |
| Focus treatment | A **filled light pill with dark content**, and no outline ring (`spec-width.webp`, `spec-padding.webp`). The current destination gets an "active indicator", "a background shape" (G-NAV text) | `surface3` fill plus the outset warm-white ring; the current entry has a 4 px bar |
| Number of destinations | "five to six"; "Avoid adding too many navigation items as this can create a vertical scroll" | One per library, and the list scrolls |

So **Google's own drawer puts its first and last items inside the 27 dp margin**, about 16–23 dp from the edge, even though its layout page asks for 27 dp. The PO's 8 dp is half of Google's figure.

Other guidance on the same point:
- G-QC TV-OV (a Tier 3 "TV Ready" criterion) asks only that no text or functionality be "partially cut off by the edges of the screen".
  - On a TV that does not overscan, 8 dp passes.
  - On a TV that crops 5%, 19 of Search's 32 dp would be cut, and TV-OV fails.
  - Whether the Shield or the owner's TV overscans is unverified.
- **Amazon is stricter.** "The focused item and on-screen text, especially, should be fully within the inner 90% (the safe zone)" (AMZ). At 8 dp, the rail fails this on Fire TV (T11-08).
- Apple insets primary content "60 points from the top and bottom" on tvOS (A-LAY), for T14.

### Recommendation: a detached panel

Even padding and the 27 dp margin can both hold if the open rail is drawn as a panel detached from the top and bottom of the screen, instead of a full-height column:

1. **Collapsed rail.** Put the first and last entries' boxes on the safe line: Search's top at 27 dp (54 cv), the account's bottom at 513 dp. The collapsed rail has no panel, so there is no edge to judge its padding against. Search then also lines up with every screen's title, which already starts at 54 cv (for example "Where is your server?" in `T4-02/after-found-servers.png`). The column reads as aligned, not unevenly padded.
2. **Open rail.** Draw `surface1` from y = 19 dp to y = 521 dp (38 cv in from the top and the bottom). Keep it flush with the left screen edge, as today, and give the right corners `radiusSheet`.
3. **Padding inside the panel.** Pad 8 dp (16 cv) on all four sides, as the PO wants. The left side is measured to the screen edge, which is the panel's own edge.
   - The panel's padding is then even everywhere, and no entry crosses the 27 dp line.
   - The ring's 3.5 dp reach is the same on every side, so the visible gap (4.5 dp) stays even too.
4. **Vertical budget.**
   - Height: 1080 − 2 × 54 − 64 (Search) − 136 (Settings and the account) = 772 cv of scroll viewport.
   - With 72 cv per entry, Home and 9 libraries fit before the list scrolls, against Home and 10 in T3-40.
   - Google's 5–6 destination limit sits well inside that.
5. **Two values the owner should judge on the Shield** (look calls; they change DESIGN §6 and §7.1, so this is a **proposal**):
   - the 19 dp of dimmed page showing above and below the open panel;
   - whether 8 dp feels cramped beside 32 dp entries.

If the owner prefers the full-height column, keep T3-40's 8 dp. It has more support than it may seem: it matches Google's own drawer in kind, though tighter. It is a risk only on overscanning TVs and for Fire TV. In that case, log a Fire TV follow-up in the backlog that re-checks AMZ's 90% rule before T11-08.

Two further proposals that would help the rail, outside T3-40's scope:
- **Entry height.** Rail entries at 32 dp tall with 4 dp gaps are two thirds of Google's 48 dp item and a third of its 12 dp gap. Going to 40 dp entries with 8 dp gaps (80 + 16 cv) would end the 0.5 dp ring clearance that T3-40 lists as a risk.
- **Open width.** 220 dp (440 cv) would meet Google's minimum.

---

## 2. Findings

Each finding gives its screenshot, source, severity (High, Medium or Low), effort (Small, Medium or Large) and kind (guideline conflict, usability problem, or taste). "**Proposal**" marks anything that would change the approved DESIGN.md.

### F1. A light-filled button reads as "focused" on Google TV, but in Octave it means "primary"

- **Evidence:** `T4-04/after-password-wrong.png` and `T4-02/after-unencrypted-dialog.png`.
  - In the first, focus is on the Password field, yet the cream "Sign in" button is the brightest, most focus-like object on the screen.
  - In the dialog, Cancel is both primary and focused. Its 3 px ring sits against a fill of almost the same colour (`focus` #fff4dc against `text1` #f2efe9), so the ring adds very little to the focused state.
- **Source:** Google's whole TV focus language is "change element background and content colour", plus scale (G-FOC).
  - A focused button turns light-filled (`button-states.webp`, state 2).
  - A focused list item becomes a light-grey fill with dark text (`list-item-states.webp`).
  - The drawer's focused item is a light pill (G-NAV figures).
  - Viewers of the Google TV launcher learn that the light thing is where focus is.
- **Severity:** High. It can misdirect every first-time viewer on every screen that has a primary button.
- **Effort:** Medium (Button, tokens, captures).
- **Kind:** Usability problem, and a conflict with the platform's convention.
- **Proposal** (DESIGN §3.1 "Primary buttons are light", §7.19):
  - An unfocused primary is tonal: `surface3`, with `text1` in weight 700.
  - Any focused button takes the light fill with `onLight` text, plus the ring and the lift.
  - "One obvious next action" survives: the primary still gets the opening focus, so it is light on arrival.

### F2. Select and Left/Right during playback do not pause or seek, which conflicts with a Tier 3 checklist item

- **Evidence:** DESIGN §7.14 "As built" (and §9's key table). Select with the chrome hidden only shows the chrome, and an arrow "shows the chrome… and does not seek". Captures: `T8-04/after-chrome-paused.png`, `after-chrome-scrubber.png`.
- **Source:** G-QC TV-PC, listed in the **Tier 3 – TV Ready** table as served: "While a video or audio is playing, pressing the D-pad center button pauses the media… The D-pad left and right buttons fast-forward and rewind."
  - Whether Play review enforces TV-PC is unverified.
- **Severity:** High. This is the floor tier of the checklist, and it costs two presses to pause.
- **Effort:** Small to Medium (`chrome-keys.ts` plus tests).
- **Kind:** Guideline conflict.
- **Proposal** (DESIGN §7.14, §9; this overturns D16 B and the T8-04 PO calls in part):
  - With the chrome hidden and no Skip or Up Next showing, select pauses and shows the chrome.
  - Left and Right seek 10 s and show the scrubber.
  - The rest of Octave's model, Skip-first and hold-to-scrub, can stay.
  - This also answers the owner's "holding to seek does nothing" with the same muscle memory (T8-05).

### F3. Two focus rings at once under a dialog

- **Evidence:** `T4-02/after-unencrypted-dialog.png`. The "Fixture Server" row behind the veil keeps its ring while Cancel has focus.
- **Source:** G-FOC: "At any given time, users should be able to focus on only one focusable element". Also DESIGN §9, "One focus at a time".
- **Severity:** Medium. **Effort:** Small (drop the ring on a trapped-out layer).
- **Kind:** Usability problem. No DESIGN change.

### F4. The scrubber's focus state is too faint for 3 m

- **Evidence:** Compare `T8-04/after-chrome-paused.png` (scrubber not focused) with `after-chrome-scrubber.png` (focused).
  - The only difference is a track going from 2 dp to 4 dp and an 8 dp thumb.
  - There is no ring, no glow and no colour change on a line 1,500 cv long.
- **Source:**
  - G-FOC's indicators are scale, border, glow and colour, used to "draw the user's attention".
  - AMZ: "When users glance away from the TV, upon return their gaze it should remain clear what options they have".
- **Severity:** Medium. **Effort:** Small.
- **Kind:** Usability problem.
- **Proposal** (DESIGN §7.14, and the T8-04 PO call "the scrubber shows focus by its thicker track and thumb"):
  - Draw the focused thumb at 24 cv with the two-tone ring.
  - Brighten both time labels from `text1` at rest to full contrast with weight 600.
  - Optionally brighten the track's unplayed part.

### F5. Octave's rail is smaller and narrower than Google's drawer spec, and it scrolls

- **Evidence:** The T3-40 spec's geometry; there is no capture of the rail. The numbers are in section 1's table:
  - item 32 dp against 48 dp;
  - gap 4 dp against 12 dp;
  - open width 200 dp against a 220 dp minimum;
  - one entry per library with scrolling, against "five to six" and "avoid… vertical scroll".
- **Source:** G-NAV.
- **Severity:** Medium for the sizes; Low for the count, which the owner decided on 2026-11-20 and which most households keep small.
- **Effort:** Medium.
- **Kind:** Guideline conflict.
- **Proposal** (DESIGN §8 `railOpenW`, the entry size and gap):
  - 440 cv open width, 80 cv entries, 16 cv gaps.
  - Keep the owner's bar as the active indicator.

### F6. No capture shows Octave's identity; the screens captured so far read as a generic dark template

- **Evidence:** Every capture: near-black panels, cream text, a monospace address chip (`T4-03`, `T4-04`), "S1 · E2" middle-dot strings (`T8-04`), left-stacked forms.
- **What FD says:** FD lists exactly these as template tells: "tinted near-black (#0B0B0B, #111) standing in for black; meta strings joined with middle dots; … a monospace face for small data labels". Its trait 1 is cream on dark, inverted.
- **What is justified on TV:**
  - Dark is Google's own tip for TV (G-COL: "Consider using a dark theme to enhance your cinematic TV experience").
  - Mono for server addresses and the Quick Connect code serves legibility.
  - Atkinson Hyperlegible is a choice grounded in the subject (3 m legibility). It is not a default.
  - "S1 · E2" may be the category's vernacular (unverified).
- **What is missing:** The distinctive ideas are DESIGN §3.2's artwork-derived accent, the "house lights" behaviour and the brass "Signal" loader. None of them appears in any capture.
  - The player's loading state is still the generic ring (`T8-04/after-loading.png`).
  - The signed-out screens show no logo at all.
- **Verdict (FD):** On the evidence so far, the look is coherent and disciplined but **generic**. The approved direction has a distinctive centre, artwork-led colour, that has not yet been shown.
- **Severity:** Medium. **Effort:** Small to Large.
- **Kind:** Taste.
- **Next steps:**
  - Capture Home and Detail with real-shaped fixture art before any further look decisions.
  - Ship the Signal loader (T3-35) before launch.
  - **Proposal** (DESIGN §7.20): put the D1 bars mark on the sign-in steps as the one brand moment there.

### F7. Text buttons do not align with the column's left edge

- **Evidence:**
  - `T4-02/after-found-servers.png`: "Search again" text starts at x = 128 cv while every heading, row and button edge starts at 96.
  - `T4-04/after-password-wrong.png`: the same for "Change server".
  - The invisible box is aligned; the words are not.
- **Source:**
  - DESIGN §9 "Room for focus": "a column of rows or fields shares the left edge of the heading above it".
  - G-LAY "Optimize with axes" (each direction a clear purpose) applies only loosely.
- **Severity:** Low. **Effort:** Small.
- **Kind:** Taste and polish.
- **Fix:** Give quiet buttons a negative leading margin equal to their padding, so their text sits on the 96 cv line. The focused fill and ring would then extend into the gutter, which §9 allows.

### F8. Sign-in screens use half the canvas, with very wide fields

- **Evidence:**
  - `T4-03`/`T4-04` Quick Connect: everything sits in the left half; the QR code is about 205 dp; the right half is empty.
  - `T4-04/after-password-wrong.png`: the username field is 864 dp wide for a username.
- **Source:**
  - G-LAY's layout templates offer "Actions" (title and subtitle on the left, actions on the right) and two-pane layouts for exactly this.
  - G-LAY "Cognitive overload": "Group contents based on user reading path".
- **Severity:** Low. **Effort:** Medium.
- **Kind:** Taste, and a look call for the owner.
- **Proposal** (DESIGN §7.20): use a two-pane layout.
  - **Left pane:** the question, the origin chip and the instruction.
  - **Right pane:** the code and QR code, or the fields capped at about 560 dp.

### F9. The ring's corner gap (T3-40)

- **Evidence:** `T8-04/after-stop-failed.png` and `T4-04/after-quick-connect-use-password.png` show the corner pinch the owner reported.
- **Source:** G-FOC "Outline indication: outline width… outline inset: spacing between the element and its outline". A constant inset is the intent.
- **Status:** T3-40 fixes it correctly. Its maths (0.26 dp at the corners today, 1.5 dp after) checks out.
- **Severity:** Medium (owner-visible). **Effort:** Small; in flight.
- **Kind:** Usability problem. No further action.

### F10. A faint box behind the loading status

- **Evidence:** `T8-04/after-loading.png`. With levels raised, a disc behind the spinner and a pill behind "Opening the original file…" show at RGB about 19–23 on a backdrop about 17–19.
- **Risk:** Invisible on the emulator capture. On a TV with lifted blacks or HDR tone mapping it may show as a smudge (unverified).
- **Source:** None external. DESIGN §7.14 specifies a 64 px status disc, not a pill behind the text.
- **Severity:** Low. **Effort:** Small.
- **Kind:** Taste and polish.
- **Fix:** Either make the disc a deliberate `surface1`, or remove both fills.

---

## 3. Where frontend-design and impeccable do not transfer to TV

- **frontend-design:**
  - Its "responsive down to mobile", hover, and "the hero" (meaning a landing page's first fold) do not apply to TV.
  - Its "visible keyboard focus" understates TV, where focus is the entire interaction model (G-FOC).
  - Its "one orchestrated motion moment" fits TV well: on TV, motion that answers a press is the focus lift itself.
- **impeccable:**
  - `android.md` is phone-first: 48 dp touch targets, FAB, snackbars, edge-to-edge insets, a bottom navigation bar. Apart from "System Back always works", none of it maps to a D-pad app.
  - Its critique flow requires a detector and browser injection. Neither was run, by instruction.
  - I used only its heuristic lens: one focus at a time (F3), consistency with platform convention (F1, F2), and recognition over recall.

## 4. What is working (stated once, not for praise)

- The copy follows Google's button guidance: sentence case, verbs, single-line labels (G-BTN). The error copy names the problem and the way out.
- The title-safe inset of 96/54 cv equals Google's 48/27 dp.
- Dark-first chrome matches G-COL.
- Back on a root screen opening the rail, then leaving, satisfies G-QC TV-DB ("Back button presses lead back to the Android TV home screen").
