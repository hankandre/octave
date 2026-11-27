# Product Owner calls on the UX review of every reachable screen, 2026-11-26

These are **not the owner's words**. The review is `docs/research/ux-review-2026-11-26.md` (emulator, build
52cdc5ad; 13 findings, F1 to F13). Each numbered call below is the Product Owner's, made under the delegation of
`docs/specs/decisions-owner-chat-2026-11-25.md` (1), and written here so each task names the call it rests on.
The owner can veto any of them, and a veto is final. Each call is also logged in `tasks/product-owner-log.md`,
in the fourth pass section of the same date.

Checked in the code before deciding:

- F1: `apps/tv/src/host/native-artwork.tsx` passes `width={width}` to the native view beside
  `style={StyleSheet.absoluteFill}`; `OctaveArtworkModule.kt` reads `Prop("width")` into `view.drawnWidth`;
  `modules/artwork/surface-allowlist.json` lists `width`. The preview view gets `blurHash` and the style only,
  which is why it is the right size. The image request is not affected: the frozen wire judge still sees
  `maxWidth` 248 for a poster (`scripts/tv-wire-artwork.test.ts`).
- F2: `apps/tv/src/shell/app-shell.tsx` points one thin guide (`shell-edge`, 4 canvas px wide) at the current
  entry; nothing else names the entry Left should reach.
- F3 and F4: `apps/tv/src/home/hero.tsx` sets no edge on the hero's buttons, and nothing scrolls Home to its top
  when a hero button takes focus from below.
- F5: `apps/tv/src/design/rows/media-row.tsx` sets a 96 px fading edge at the row's end and no space after the
  last card.

Not checked: F6 to F13 beyond the review's own captures.

## 1. The artwork view's width prop is renamed `drawnWidth` (T3-42)

Every artwork picture is drawn twice as wide as its frame on a 1080p TV, so Home's cards, the backdrop and the
player's loading screen show a doubled crop. The prop named `width` is read twice: by the module, as the drawn
width in canvas px, and by React Native's layout, as the view's width in dp.

The call: the prop is renamed `drawnWidth`. Its value and meaning do not change (the drawn width in whole canvas
px, which sizes the image request). The view keeps six props, one event and no function. No prop React passes to
the view may be a name React Native's layout reads, and a test holds that.

What approval the change needs, and has:

- **This call is the approval of the surface change.** A rename of one view prop adds no method, no event and no
  prop, so it is not a new decision record; it follows the T3-39 precedent, where a changed prop list was
  recorded as a dated amendment to decision 0005. T3-42 writes that amendment ("Amendment, 2026-11-26 (T3-42):
  the width prop's name") in its pull request, and the reviewer checks it against this call.
- **Documents in the same pull request:** `modules/artwork/surface-allowlist.json`, the TypeScript types in
  `modules/artwork/src/index.ts`, `docs/security.md` (the "Images are requested natively" row and the artwork
  allowlist line), `ARCHITECTURE.md` where it names the prop, and a "Changed native surface" section in the pull
  request.
- **Frozen tests.** These pin the name `width` and are frozen by T3-11 or T3-39:
  `modules/artwork/android/src/test/java/dev/octave/artwork/ModuleSurfaceTest.kt`,
  `scripts/tv-artwork-module.test.ts`, `scripts/tv-artwork-preview.test.ts`,
  `apps/tv/src/host/native-artwork.test.tsx` and `apps/tv/src/host/native-artwork-preview.test.tsx`; the refiner
  lists any other. They contradict this call, so the ruling is given here: at milestone 0 the implementer
  returns them, and the Product Owner changes the prop's name in each, and nothing else, in one commit with a
  `Frozen-Test-Change` trailer per file. No assertion is removed or loosened. The T3-39 precedent
  (`docs/specs/T3-39.tests.json`, item 8).
- **Not needed:** an owner approval file (no wording, look or direction changes), a new session method, or a
  change to the image request.

Not chosen: dropping the prop and reading the width from the view's own layout. It makes the surface smaller,
but the request would wait for layout and the native side would have to convert device px back to canvas px; it
is a larger change to code the wire tests hold, and the owner is looking at the crop now.

T3-42 is first in the `native-session` lane and takes the serial slot before the player lane's next task.

## 2. Left opens the rail on the current entry, from anywhere (T3-43)

No new rule: `DESIGN.md` 7.1 already says Left from a screen's first column opens the rail "with focus on the
current screen's entry". The app lands on the nearest entry instead (Settings from Recently added's first card;
Home from the Search placeholder). T3-43 fixes it for every first-column control and proves it on the emulator.

## 3. Up into the hero lands on its primary action, with the hero in view (T5-09)

The call: Up from any card of Home's first row lands on the hero's primary action (More info when the hero has
no primary), and Home scrolls to its top, so the title, facts and overview are on screen. Right on the hero's
last button does nothing.

Why: today Up from the third card lands on More info, by nearest centre, with the title scrolled off; and Right
past More info jumps two rows down. `DESIGN.md` 7.4's nearest-centre rule is written for rows of cards; the hero
is two buttons at the left, and principle 2 gives it one obvious action. "Nothing moves under you" holds for a
press that goes nowhere.

To judge on the TV: whether Up from a card far to the right should land on Resume, at the far left. A veto
restores nearest centre; the scroll to the top and the Right edge stay.

## 4. A row's last card clears the fade (T5-09)

No new rule: `DESIGN.md` 9 keeps the focused card 96 px from any edge, and "Room for focus" says nothing covers
a ring. The end fade covers the focused last card, its ring and its caption. It rides in T5-09 because both are
Home's rows.

## 5. A dialog's focused button covers no part of its neighbour (T3-41, scope edit)

No new rule: `DESIGN.md` 9, "Room for focus". In the unencrypted-connection dialog the focused "Connect without
encryption" overlaps Cancel. T3-41 already redraws these buttons and captures this dialog, so it takes one more
acceptance item. A scope edit: it changes no wording and no look the design did not already ask for.

## 6. Deferred, with what brings each back

- **Fast presses that lose the visible focus (F6).** Shown only with injected key events and not for a held key.
  Back when the owner sees it with the remote, or T3-10's scripted focus test fails on it.
- **The server step's opening focus and the focus on return from Quick Connect (F8).** The opening focus on
  "Search again" is pinned by the frozen smoke oracle and changes when discovery lists servers; it is weighed in
  T4-01's spec. A stored sign-in means the owner rarely sees this step.
- **The hero's overview contrast (F10).** Measured over a backdrop drawn at twice its width. Measured again on
  T5-04's captures of the loaded Home once T3-42 is merged; a reading still under 4.5:1 becomes a task.
- **Time left on a film's hero (F11).** Back with T7-01, which builds the same facts for a film's page.
- **The backdrop following the focused card while the hero's title stays (F9).** `DESIGN.md` 7.2 specifies it
  and decision 5 of the carried list accepted it. The owner's eyes decide; the default is to keep it.

## 7. Dismissed

- **Placeholder screens clip a ring and are titled "Octave" (F12).** Each placeholder is replaced by its own
  screen task (T6, T7, T9); polishing them builds nothing that ships.
- **The open rail cuts the hero's text with a hard edge (F13).** `DESIGN.md` 6 puts the open rail over the
  content on `surface1`. A scrim beside it is a look nobody asked for; the owner is asked, and the default is to
  keep it.

## 8. Two backlog lines from task runs

- **A repeat sign-in the viewer abandons (T4-05).** Decided: the earlier saved sign-in is kept. Leaving a
  sign-in must not sign anyone out; T4-06's own acceptance says "Add account starts sign-in without signing
  anyone out". It is not built now: today the path is reached only from "Change server" at a launch whose server
  did not answer, or after the server ended the sign-in, and the cost is one more sign-in, with no leak. T4-06
  makes the path ordinary (Add account), so T4-06's spec carries it, by saving the earlier record again when the
  late session is ended, with no new native method. If that needs a method, it returns for a decision.
- **The frozen T3-40 test that counts on a layout event bubbling.** Left as it is: it contradicts neither the
  acceptance nor the spec, and it passes. Back when the testing library is upgraded to the version that stops
  bubbling; that upgrade's task returns the file for a ruling, and firing the event on the handling element is
  then allowed.
