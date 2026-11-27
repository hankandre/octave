# Design brief: one pattern for every full-screen message

**Why.** The owner's feedback on `T4-06/16-switch-failed.png`, in substance: the message is ugly to read, it all sits left-aligned in the top-left corner, and on a TV that is not where people look. The couldn't-check screen at launch already ships that layout. This is owner UX feedback, so it outranks the earlier "no new words" call (T4-05 Q12) for this screen.

Status: a proposal. Every new word needs approval. "01" to "15" name the mockups here.

## 1. The experience

From across the room, the viewer needs three answers, in this order:

1. **What happened?** The heading. A few large words that read in one glance.
2. **Can I fix it, and how?** One short sentence that names the thing to check. It blames nobody.
3. **What do I press?** The focused button. Pressing select without reading further does the most useful thing.

"Which server?" comes beside these, for the household that has two, or the person who has to repair one. It never interrupts the sentence.

### 1.1 Situations, press by press

| Situation | What the viewer does and sees |
|---|---|
| Server off at launch | Opens Octave. Sees the loading screen in the middle, with the server under it. The mark and heading change in place: "Can't reach the server". Turns the server on, presses select ("Try again"), sees loading, then Home. |
| Failed account switch | Chooses a tile. Same loading, same failure. Select retries. Right, select, or Back, returns to "Who's watching?". |
| The address redirects | Reads that the address redirects. Select ("Change server") opens the server step. |
| Server too old | Reads that the server needs an update. Updates it, or asks whoever runs it, then presses select to retry. |
| Quick Connect code expired or refused | The code gives way to the message. Select gets a new code. |
| Page not found | Select goes Home. |

### 1.2 Behaviours

**Reading**

- **M1.** A full-screen message is centred left to right, in the middle band of the screen, inside the title-safe inset (96, 54). Nothing sits in a corner.
- **M2.** Top to bottom it shows: mark, heading, sentence, server (if one is involved), actions. Nothing else. There is no "What you can do" label.
- **M3.** The heading is fixed text for its state. It holds no server name, address, title or other variable, and fits one line.
- **M4.** The sentence is one sentence, at most two lines, 840 wide at most. It holds no name or address.
- **M5.** The server's readable name, when known, is on its own line. The full address is under it, smaller, in mono. Neither is ever part of the heading or sentence.
- **M6.** With no known name, only the address shows, in the same place. Octave never invents a name or shows an address as if it were one (04).
- **M7.** A long name is one line cut with "…". A long address wraps to at most three lines and is then cut at its end, so the host stays visible. Neither moves or covers a button (10).
- **M8.** No status code, exception text, server-supplied reason, id or token appears. The server's own name is the one server-supplied string.
- **M9.** The server block is not focusable and has no box, so it never looks like a button.

**Acting**

- **M10.** Every failure has at least one action. When it appears, the first action holds focus. It is the primary and sits first from the left.
- **M11.** Actions are one centred row, primary first. Left and Right move along it and stop at its ends. Up and Down do nothing. Where a rail exists, Left from the first action opens it (13, 14).
- **M12.** Select runs the focused action once. A second press while it runs does nothing.
- **M13.** The primary is the action most likely to help: retry when waiting or repairing can fix it; "Change server" for a redirect; "Get a new code" for a dead code.
- **M14.** Back does what that situation's rules say (section 6). It never signs anyone out or deletes anything.
- **M15.** Octave never retries or leaves the screen by itself.

**Loading, then failure**

- **M16.** The loading screen uses the same places: the loader where the mark goes, "Loading…" where the heading goes, and the server in the server's place (03).
- **M17.** When loading fails, the mark and heading change in place and the sentence and actions appear in empty space. The mark, heading and server do not move.
- **M18.** The loading screen has nothing to focus. Back works as the situation's rules say.
- **M19.** "Try again" returns to the loading screen and then to Home or a message. If the same failure returns, focus is on its primary again.
- **M20.** With reduced motion the mark is still and "Loading…" stays. Nothing flashes or slides. A change of state is instant or a plain fade of 120 ms or less.

**Accessibility**

- **M21.** Every state, loading included, has exactly one heading, with the heading role.
- **M22.** When a state appears, TalkBack reads the heading, sentence and server once, then the focused action. It does not repeat them on focus moves.
- **M23.** Colour is never the only signal: the heading says what the mark shows.

**Never**

- **M24.** A dead end; focus on nothing once a failure shows; an address run into a sentence; layout that jumps between loading and failure; a screen headed by a task it can no longer do ("Approve this sign-in on your phone" with no code).

## 2. Two options for "unreachable"

| | **A, centred stack (01), recommended** | B, server as subject (02) |
|---|---|---|
| Layout | One column on the centre line | Server on the left, message and stacked buttons on the right |
| Eye path | One: down | Two: the eye picks a side first |
| Which server | Clear but secondary | Very clear; competes with what happened |
| No server name | The same screen | The large half is left with a long address or nothing |
| No server at all (not-found) | The same screen | Needs a second layout |
| Loading | Swaps in place | One half sits empty |

**A**, because it answers the three questions in the order the viewer asks them, works with or without a name or a server, and matches the centred player failure and "Who's watching?". B is better only if telling servers apart mattered more than knowing what happened.

## 3. The pattern

Canvas px at 1920x1080. Tops are fixed rather than flex-centred, so a one-line or two-line sentence moves nothing (M17).

| Slot | Top | Look |
|---|---|---|
| Mark | 232, in a 96-high box | `emptyIcon` (72) line icon, as `DESIGN.md` 7.17 |
| Heading | 360 | `typeTitle`, `text1` |
| Sentence | 439; two lines reserved | `typeBodyLg`, `text2`, `dialogMaxW` (840), balanced wrap |
| Server | 569 | Name in `typeHeading`, `text1`; address 8 below in `typeMono`, `text2`; 840 wide |
| Actions | 744 with a server; 582 without | 72-high buttons, `space6` (32) apart: first primary, the rest secondary |

- **Marks:** `server-off` for unreachable; `alert-triangle` for every other failure; both in `notice` (10.8:1), as the Notice component colours its icon today. `map-question` in `text2` for not-found, which is not a fault. New Tabler glyphs: `server-off` 0xf19e, `alert-triangle` 0xea06, `map-question` 0xfbd0.
- **Loader:** the player's 64 ring until T3-35. The Signal loader then takes the mark box; its full form must fit 96 high.
- **Background:** `surface0`. A state about a title keeps `DESIGN.md` 7.16's backdrop at 30% under scrims, with the title in `typeMeta` at top 162 (15).
- **With the rail:** centred on the screen, not on the space beside the rail, so a state looks the same with and without it.
- These tops are new layout values. They need tokens in `DESIGN.md` 8.
- Longer text: a heading that wraps is a copy fault. Check it in other languages when there are any.
- **Buttons** are drawn as built. T3-41 will make an unfocused primary tonal, which helps here: in 05 the unfocused "Try again" still looks focused.

### What is not a full-screen message

These stay as they are: inline status on the server step and the password step (the viewer is at a form and must keep what they typed); row errors (`InlineError`); toasts and the player's OSD; dialogs. The server step's inline failure can fall far from the eye or below the list. That is a real weakness, but it is a form problem and outside this brief.

## 4. States and words

"Kept" words are in `DESIGN.md` today. **Every other string is a proposal.**

| State | Heading | Sentence | Actions, primary first | Mockup |
|---|---|---|---|---|
| Checking a sign-in | Loading… (kept) | none | none | 03 |
| Launch or switch, unreachable or timeout | **Can't reach the server** | Check that the server is on, then try again. (kept, from the playback row) | Try again, Change server (kept) | 01, 04, 05, 10 |
| Switch, any failure | as at launch | as at launch | Try again, **Who's watching?** (words kept, new as a button) | 06 |
| Redirect | **This address redirects elsewhere** | **Octave doesn't follow redirects, so choose the server's final address.** | Change server, Try again | 07 |
| Unsupported version | **This server needs an update** | **Update it to Jellyfin 10.11 or newer, then try again.** | Try again, Change server | 08 |
| Anything else, another server answering included | **Something went wrong** | **Octave couldn't check your sign-in.** | Try again, Change server | 09 |
| Quick Connect, expired | **This code has expired** | Get a new code to try again. (kept) | Get a new code, Use a password, Change server (kept) | 11 |
| Quick Connect, refused | **The server didn't accept this code** | Get a new code to try again. (kept) | as above | as 11 |
| Quick Connect, unreachable | **Can't reach the server** | **Check the address and that the server is running.** (kept words, now alone) | Try again, Use a password, Change server | 12 |
| Quick Connect, redirect | as "Redirect" | as "Redirect" | Change server only (kept rule) | as 07 |
| Quick Connect, anything else | **Something went wrong** | **Octave couldn't finish signing in.** | Try again, Use a password, Change server | as 09 |
| Page not found | This page isn't available (kept) | It may have moved, or this account can't see it. (kept) | Go home (kept) | 13 |
| Home cannot load (T5-04) | **Can't reach the server** | Check that the server is on, then try again. | Retry (kept) | 14 |
| Playback could not start (T8-17) | Playback could not start (kept) | Check that the server is on, then try again. (kept words, name removed) | Retry, Back to details (kept) | 15 |

The other whole-screen states in `DESIGN.md` 10 take the same slots when built, with their approved titles and bodies: item gone, library not available, and the empty states. Those with `{server}` or `{term}` inside a sentence need a decision under M4 and M5. The playback server-error row would become "**The server had a problem starting playback, so try again in a moment.**" The stop-failed row is two approved sentences; it takes the layout and keeps its words.

"Refused plain HTTP", "not an address", "Unicode host" and "found server answered differently" appear inline on the server step today and stay there. If a launch check can ever return one of them, it needs its own row; until then it shows "Something went wrong". Whether that can happen is unverified.

**Not chosen:** the server's name in the heading ("Can't reach Lantern Loft"). It reads warmly and follows the voice example in `DESIGN.md` 10, but long names wrap, an unknown name needs a second heading, and the owner asked for the name to be readable and apart from the sentence.

**Not added:** "You're still signed in." It would reassure, but it makes a second sentence (open choice P3).

## 5. Where today's screens fall short

| Screen (capture) | Against `DESIGN.md` | Also |
|---|---|---|
| Couldn't check the sign-in (`T4-05/after-restore-unreachable.png`, `restore-unavailable.tsx`) | **11.6:** the heading role sits on a whole body-size sentence, which names nothing at a glance. **7.16:** a full-screen state with no title, and it does not use `Notice`. It follows its own text in 7.20, so the gap is between 7.20 and these two. | Top-left; the address is inside the sentence; no server name; a quiet second action reads as plain text; the same primary for a redirect, which retrying cannot fix. |
| Loading at launch (`T4-05/after-restore-loading.png`, `app-root.tsx`) | **11.6:** no heading. **5** and **7.17:** no loader yet (T3-35). **7.17** gives no layout for full-screen loading: a gap in the document. | Top-left; does not say which server. |
| Quick Connect failures (`T4-03/after-expired.png`, `after-refused.png`) | **11.6:** the heading still says "Approve this sign-in on your phone" when there is nothing to approve. | Top-left. 7.20 asks for a focused button and has one. |
| Quick Connect before the code (`quick-connect-step.tsx`) | none found | "Loading…" is a body line under that same heading. No capture. |
| Not found (`not-found-screen.tsx`, `notice.tsx`) | **7.16:** follows it. | Left-aligned at mid-height; "What you can do" is a label above one button; no mark. From the code; no capture. |
| Playback failure (`T8-03/after-failure.png`, `player-failure.tsx`) | **7.16:** should be a Notice with backdrop, title and actions; it has none of the three except on stop-failed. Actions are T8-17's. **9:** a failure with no button focuses nothing. | Centred already. The server's name runs into the sentence, and the sentence wraps to one orphan word. |
| Home while loading or after a failed load (`home-screen.tsx`) | **11.6:** no heading. **9** and **7.17:** plain surface, nothing focused, no skeleton, no error. | T5-04's job. |
| Stop failed (`T8-04/after-stop-failed.png`) | no backdrop or title (7.16) | Reads well. |

`EmptyState` (7.17) exists in code and no screen uses it. It and `Notice` are two near-identical centred-message designs with different alignment and sizes. **Recommendation:** one component with the slots in section 3, serving both.

## 6. Keys and Back, by situation

Focus starts on the first action; Left and Right follow M11; select runs the focused action.

| Situation | Back |
|---|---|
| Launch with one account: loading or failure | Leaves the app (T4-05, unchanged) |
| After a choice on "Who's watching?": loading or failure | Returns there, on the chosen tile (T4-06 design, B36) |
| Quick Connect | As built |
| Not found | As the shell does today |
| Home cannot load | As on any root screen: opens the rail |
| Playback | As the player does today |

## 7. What changes, and who picks it up

### Shipped screens that change

1. The couldn't-check screen at launch (01, 04, 07 to 10).
2. Loading at launch (03).
3. Quick Connect's failures and its first loading state (11, 12). The waiting screen with the code does not change.
4. Not found (13), through the shared component.
5. Playback failure (15): layout now; its sentences and actions with T8-17.

The jump from the left-aligned QR screen to a centred failure is accepted: it is a change of screen, not loading turning into failure. M16 for Quick Connect covers only "Loading…" before the code.

### For the Product Owner

- **A new task is needed:** "Show every full-screen message in one centred pattern". It covers the shared component, items 1 to 4, the layout part of 5, the tokens and glyphs, and `DESIGN.md` 5, 7.16, 7.17, 7.20, 8, 10 and 12. None of the tasks read for this brief covers it. Put it **before T4-06**, so the switch failure uses it and is not built twice.
- **Owner approval** for the new words in section 4, and for dropping "What you can do". `AGENTS.md` ties on-screen wording and look to an owner approval file. The feedback asks for this redesign but does not approve the strings.
- **Frozen tests will fail** and need a ruling before the task:
  - `apps/tv/src/app-root-restore.test.tsx` (T4-05 item 2): the whole sentence with the address, as the heading, in `text1`; redirect with "Try again" focused.
  - `apps/tv/src/sign-in/quick-connect-step.test.tsx` and its copy support (T4-03 item 4): each failure as one exact string with its own live region.
  - `apps/tv/src/signed-in/signed-in-play-guard.test.tsx` reads the playback sentence with the server name; check whether it is frozen.
  - Others that depend on button order or layout: unverified. No test found asserts "What you can do".
- **T5-04** item 6 fixes "Couldn't reach {server}. …", with the name in the sentence, and item 4 asks for a sentence "naming the server". Reword both: the screen names the server, apart from the sentence.
- **T8-17** and the copy in `playback-failure.ts` (T8-25 ties it to `DESIGN.md` 10 word for word): remove `{server}` from sentences on full screens. The "Couldn't save your progress to {server}" notice is an OSD line and can stay.
- **T4-05 Q12 and `DESIGN.md` 7.20** (primary and quiet buttons, no new words) are replaced for this screen. A redirect makes "Change server" primary.
- **The server name at launch** is not available today: the stored record and the `unavailable` outcome carry only the address. Until a saved name exists, launch shows 04. The non-secret account list in the T4-06 brief (X5) is where it would live. A native change needs a decision record. When the server answers and only the sign-in check fails, the core already has the name and could pass it on.
- **Related tasks:** T3-35 (loader in the mark box), T3-41 (button fills), T6-01 and T7-01 (their unavailable states use this pattern), T5-04, T8-17.

## 8. Open choices

| # | Choice | Lean |
|---|---|---|
| P1 | A or B | A |
| P2 | Server name in the heading, or fixed headings with the name below | Fixed headings (M3) |
| P3 | Add "You're still signed in." on launch failures | No. Check it in dogfooding. |
| P4 | Redirect at launch: keep "Try again" at all? | Keep it second: the server's owner may fix the redirect |
| P5 | A fast failure after "Try again" flashes loading and may look as if nothing happened. Hold loading for a minimum time? | Judge on the TV first. It would need a token. |
| P6 | Delay the loading screen by `skeletonDelayMs` to avoid a flash on fast launches | No. Today it shows at once, and a frozen test expects that. |
| P7 | Say which server while loading | Yes, it costs no words. It needs the saved name for the first line. |

## 9. Mockups

| File | Shows |
|---|---|
| `01-option-a-unreachable.png` | Option A, recommended |
| `02-option-b-unreachable.png` | Option B |
| `03-loading.png` | The loading state in the same places |
| `04-unreachable-no-name.png` | No name known: today's case at launch |
| `05-second-action-focused.png` | Focus on the second action |
| `06-switch-failed.png` | Failed account switch (also now `../T4-06/16-switch-failed.png`) |
| `07-redirect.png` | Redirect |
| `08-unsupported-version.png` | Unsupported version |
| `09-anything-else.png` | Anything else |
| `10-long-name-and-address.png` | Long name and long address |
| `11-quick-connect-expired.png` | Expired code, three actions |
| `12-quick-connect-unreachable.png` | Sign-in step, unreachable |
| `13-not-found.png` | Not found, with the rail |
| `14-home-unreachable.png` | Home cannot load, with the rail |
| `15-player-could-not-start.png` | Playback could not start, over invented art |

Source: `mockups.html?m=<name>`. It uses the repo's fonts and the installed Tabler font (`pnpm install` first; allow file access).

### What the mockups cannot prove

- That the icon, heading and focus read from the sofa on the owner's TV, or how `notice` and `text2` look with lifted blacks or HDR.
- React Native's text wrapping, balance, cutting of long addresses and font drawing. Android cuts only the end of multi-line text; how it breaks a long URL is unverified.
- That nothing moves between states on a device, focus moves, motion, the loader, timing and flashes.
- TalkBack order and how often it speaks (M22).
- Overscan.

## 10. Sources

- The repo files and captures named above, and `DESIGN.md` 3.1, 5, 7.16, 7.17, 7.20, 9, 10, 11.
- Android TV navigation, read 2026-11-26: keep an item in focus that the viewer can act on; predictable Back; no exit confirmation. <https://developer.android.com/training/tv/get-started/navigation>. M18 departs from "always in focus" while loading, as the app does today.
- Android TV focus: one focused element; scale and outline as indicators. <https://developer.android.com/design/ui/tv/guides/styles/focus-system>
- **Unverified:** I did not look for a TV error-screen design page, so the centred layout rests on the owner's feedback and this brief's judgement.
