# Calls awaiting the owner

The one list of calls the owner can still veto or has said they will judge on the TV (`docs/decisions/0008-owner-answers-guiding-documents.md`, question 3). The Product Owner keeps it. A call leaves the list when the owner confirms or vetoes it; the answer goes to a decision file, and any change it makes goes through decision 0007.

It was started from `DESIGN.md`'s status lines and its section 12 ("Decisions" and "Awaiting the owner"), which this list replaces; the blocks below are copied word for word. Other Product Owner calls made for the owner's veto are in `tasks/product-owner-log.md` and `docs/specs/decisions-product-owner-*.md`; this list does not yet gather them.

## To judge on the TV

- **The token values.** They were carried over from the desktop system's TV form; T3-06 turned them into TypeScript and checks them on the 1920×1080 canvas, and the owner confirms them on the Shield. (From `DESIGN.md`'s status line and "Awaiting the owner".)
- **The lift and memory choice:** decision 0004, choice 2.
- **The look values the owner accepted on 2026-11-22 "for now, to be judged again on the Shield at the token check"** (from `DESIGN.md` section 12; also recorded in `docs/specs/T3-06.md` and `docs/specs/T3-08.md`):

The owner accepted these look values for now, to be judged again on the Shield at the token check:

- Switch thumb 28 px. On is a `text1` track with an `onLight` thumb. Off is a `surface3` track with a `text2` thumb.
- TextField border 2 px `lineStrong`.
- A disabled label is `text3` on the normal fill.
- A toast is at most 840 px wide.
- A skeleton never shimmers.
- Cards (T3-08): 24 px between cards (`space5`), 24 px from the art to the title, 16 px (`space4`) from a row's title to its cards, and the subtitle and the missing-image title in `text2`.
- The right edge of a row has a 96 px fading edge, so Android keeps the focused card 96 px in; the same margin applies on the left, with no fade.
- The played mark's disc shows Tabler's check (T3-34).
- A focused card has the ring, the static lift and `shadowLift`, as §7.5 says; T3-12 and T3-18 measure the shadow's cost.

## Open for the owner

- A profile PIN (T12-01); recent searches (T12-05).

## Answered by the Product Owner under the delegation, for the owner's veto

- **The sign-in screen with its QR code** (named as the owner's call in `DESIGN.md`'s status line and "Awaiting the owner", T1-08): answered by the Product Owner in the T4-02, T4-03 and T4-04 calls below. `DESIGN.md` 7.20 says: "The QR code's content, its size, and the sign-in screen's layout are the owner's call; the Product Owner decided them under the delegation (section 12, T4-03), for the owner's veto."
- **The countdown's place** (`DESIGN.md` 7.18): "The countdown is placed with auto-play by the Product Owner, not by the owner."
- **A card's picture fading in over its preview** (owner decision of 2026-11-23, with the fade listed for the owner's veto; `docs/specs/decisions-owner-inbox-2026-11-23b.md` §3):

### Owner decisions, 2026-11-23

- **A card's artwork while it loads (T3-39).** The frame shows a blurred preview of the picture, decoded from the image's BlurHash, in place of a plain `surface2` stand-in (`docs/specs/decisions-owner-inbox-2026-11-23b.md` §3; 7.5). The picture fades in over the preview the way the ambient backdrop does (7.2): `durSlow` with `easeInOut`, 120 ms on opacity only under reduced motion. The fade reuses that approved behaviour and is listed for the owner's veto (an instant swap needs no native change); it also runs when a recycled card remounts with its picture already cached.

### Product Owner decisions, 2026-11-26 (T8-04), for the owner's veto

Made under the owner's delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1) and provisional; the reasons are in `docs/specs/T8-04.md`, "For the owner's veto".

- The player's chrome is React Native over the native picture (7.14; decision 0003's amendment).
- Back stops the player before it leaves; a failed stop keeps the screen with "Back to details" focused.
- Select on the scrubber pauses and resumes. T8-05 keeps one condition: while a held scrub is pending, select commits it and does not toggle.
- Pausing a hidden chrome with Play/Pause shows it with focus on Play or Pause.
- An invisible element holds focus while only the picture shows.
- The scrubber shows focus by its thicker track and thumb. Only working controls are drawn.
- Icons: `arrow-left`, `player-play`, `player-pause`, `rewind-backward-10`, `rewind-forward-10`.
- Wording: "S1 · E2 {title}"; "Loading…" before a plan and "Opening the original file…" after; for TalkBack, "Player controls", "Seek", "Rewind 10 seconds" and "Forward 10 seconds".
- The picture's frame in its own shape is a later task, so a film that is not 16:9 may be drawn stretched until then.

### Product Owner calls, 2026-11-26 (T4-02)

These are the Product Owner's calls under the delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1), not the owner's words. Each is provisional: the owner can veto it. The reasons are in `docs/specs/T4-02.md`.

- **C1. Copy.** The sign-in rows of section 10 for a redirect, an unsupported version, text that is not an address, a found server that answered differently, and the unencrypted-connection dialog. The "not an address" sentence is new wording. The dialog does not say that Octave will remember the choice, because the choice is kept for one launch only.
- **C2. Back on the first sign-in step.** While a server is being probed, Back cancels the probe and stays on the step. After "Enter address" reveals the field, Back does what it does on the rest of the step, and the field stays. With nothing to stop, Back leaves the app without a question.
- **C3.** Remembered servers have no section title.
- **C4.** The conflict line on a found server: "Another address on this network answered as this server."
- **C5.** There is no Connect button: the keyboard's action key submits the address.
- **C6.** "Loading…" is the status line while a probe runs.
- **C7.** A typed address with no scheme gets `http://` for this device or a home-network host, and `https://` otherwise.
- **C8.** A search of the network that fails shows nothing; the address field shows, as when no server is found.
- **C9.** The origin chip is `typeMono` on `surface2` at `radiusPill`, holding the full normalised address.
- **C10. Rows and fields do not lift.** A row or a field shows focus with the ring and, for a row, a `surface3` fill; it never scales. Art and compact controls keep the lift. A column of rows shares its heading's left edge, and no container clips a ring, a lift or a shadow (section 9, "What lifts" and "Room for focus"; `tasks/product-owner-log.md`, "2026-11-26, T4-02 ruling, Captures"). The first captures of the server step showed a lifted row cut off at both ends. This applies to every list the app draws later: pickers, menus, chapters and Settings.
- **C11. The ring's offset on a bordered control.** The 3 px offset is measured from the control's outer edge, border included (7.19). The retaken capture showed the Server URL field's ring 1 px from the field, because the field's 2 px border used up 2 of the 3 px. This reads the existing rule; it adds no value.
- **C12. A field's cursor.** The cursor is `text1`, not the platform's teal; selected text is marked with `fillSecondary` and a selection handle is `text1` (7.19). `focus` was not chosen: section 3.1 keeps it for the ring alone.

### Product Owner calls, 2026-11-26 (T4-03)

These are the Product Owner's calls under the delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1), not the owner's words. Each is provisional: the owner can veto it. The reasons are in `docs/specs/T4-03.md`.

- **C1.** The heading "Approve this sign-in on your phone" and the sentence beside the QR code, "Scan the code with your phone, or enter the code in Quick Connect.", are the "Sign-in, Quick Connect" row of section 10.
- **C2.** The no-link sentence: "On your phone, open {address} and enter this code in Quick Connect." (new wording). To judge: on a loopback server, the only no-link case today, the address is the TV's own and a phone cannot open it.
- **C3.** "This code has expired. Get a new code to try again." and "The server didn't accept this code. Get a new code to try again.", each with the button "Get a new code" (new wording); "Try again" for unreachable and other.
- **C4.** Opening focus is on "Change server", the step's only control until T4-04's "Use a password", which then goes before it and takes the opening focus. To judge: a select pressed by habit on this step returns to step 1.
- **C5.** The QR code may be 480 canvas px (`qrSize`) including a four-module quiet zone, not 360: `onLight` modules on a `text1` field, to the right of the code with its top level with the code's, error correction M. As drawn, modules are whole dp: on a 1080p TV a 33-module code has 10 px modules and is 410 px wide, about 6.3 mm a module on a 55-inch panel. Reasoned, not measured; the owner judges it from the sofa.
- **C6.** The code is grouped three and three, and TalkBack reads it digit by digit.
- **C7.** The password step's placeholder is "Who is signing in?", "Not available yet." and "Change server", with no "Quick Connect is off" sentence.
- **C8.** A failure removes the code from the screen.

### Product Owner calls, 2026-11-26 (T4-04)

These are the Product Owner's calls under the delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1), not the owner's words. Each is provisional: the owner can veto it. The reasons are in `docs/specs/T4-04.md`.

- **C1. Layout.** The password step reads top to bottom: "Who is signing in?" and the origin chip; Username; Password; the Show password row; the status or failure line; Sign in (primary); Change server (quiet, last, as on the Quick Connect step).
- **C2. Opening focus** is the Username field, not Sign in: over two empty fields, Sign in does nothing useful.
- **C3. Keys.** Username's action key is "Next" and moves focus to Password; the keyboard closes and select opens it again, an extra press to judge on the TV. Password's action key is "Go" and signs in.
- **C4. An empty username** sends nothing and focuses Username, with no sentence. An empty password is sent. The username is sent as typed. **Narrowed:** after a failed sign-in, an empty password is not sent until the viewer changes Username or Password (any edit counts, even one that leaves the password empty). Until then Sign in and "Go" send nothing, the failure sentence stays and focus goes to Password. When the failed try was itself sent with an empty password and the answer was not a 401 or a 403, it may be sent again with no edit. A cancelled sign-in is not a failure. To judge: after a wrong password, a press on Sign in does nothing until a field is edited, and says nothing new; a viewer whose account has no password, and who got a 401 or a 403, must change a field first. Restoring "an empty password is always sent" would cost this: on a Jellyfin account whose lockout limit is set, each such press is one of the tries before the account is disabled for everyone (a policy value of 0 means 3; a new account has no limit set, and what Jellyfin's setup wizard and dashboard send is unverified).
- **C5. While signing in** the status line says "Loading…", a second press does nothing and the fields stay enabled.
- **C6. Failures.** A 403 gets a new sentence: "This account can't sign in right now. Try again later. If it still doesn't work, ask the server's owner." After any failure the password is cleared, the username kept and focus goes to Password; a redirect focuses Change server. The sentence is `text1` with no icon, as on the Quick Connect step.
- **C7. "Use a password"** on the Quick Connect step is secondary, between a failure's retry and Change server, and takes the opening focus. It is hidden after a redirect. After "Get a new code" or "Try again", focus goes to it.
- **C8. Show password** is a row with the label "Show password" and a switch showing "On" or "Off", off every time the step opens.
- **C9. Back to Quick Connect.** Back from a password step opened by "Use a password" returns to the Quick Connect step with a new code, focus on "Use a password".
- **C10. Back during a sign-in** leaves the step, drops the answer and ends a session that arrives late. The request itself is not stopped: the password still reaches the server, and a wrong one is still counted.
- **C11. No "Quick Connect is off" sentence.** The password step does not show it; its row in section 10 is marked not shown.
- **C12. Autofill and a shown password.** Neither field is offered to Android autofill. While Show password is on, the field asks for a visible password, which react-native-tvos 0.88.1 does not pass to the keyboard, so the keyboard sees an ordinary field and may suggest or learn what is typed while the password is shown. Vetoing Show password removes that exposure; the fix that keeps it is a React Native patch (backlog).

### Product Owner calls, 2026-11-26b (T3-40)

These are the Product Owner's calls under the delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1), not the owner's words. Each is provisional: the owner can veto it. The reasons are in `docs/specs/decisions-product-owner-2026-11-26b.md`, whose numbers these are.

- **1. Ring corners.** A fault, not a look call: the ring keeps the same gap at a control's corners as along its sides (section 9, "Room for focus").
- **2. A rail entry does not lift.** It shows the ring and a `surface3` fill. A veto restores the lift and needs a wider open rail.
- **3. Nothing crops a rail entry's ring**, and it covers no neighbour, in the scrolling group and at the rail's edges (section 9, "Room for focus").
- **4. The rail's padding is 16 px on all four sides**, in place of the 54 px title-safe inset above and below (section 6). To judge on the Shield: whether Search and the account sit too near the edge.
- **5. The bar on the current entry stays.**

### Product Owner calls, 2026-11-26 (T4-05)

These are the Product Owner's calls under the delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1), not the owner's words. Each is provisional: the owner can veto it. The ruling is in `tasks/product-owner-log.md`, "2026-11-26, T4-05 ruling, Spec and Check".

- **Q4. No Home before the server answers.** Home opens from a stored sign-in only after the server answered, in this launch, as the one the sign-in was made on and accepted the session. A server that is off at launch costs one press on "Try again".
- **Q6. Back after the server ended the sign-in.** Username filled, focus on Password, the empty password held until an edit, and no sentence saying why. The opening focus departs from T4-04 C2 on this route only.
- **Q7. While checking.** "Loading…" alone; five seconds each for the server's answer and the session's; no second try by itself; Back leaves the app.
- **Q10. No sign-out control yet.** A viewer whose stored sign-in works reaches sign-in only by clearing the app's data until T4-06 or T9-05.
- **Q11. No warning at launch over plain HTTP at home.** A stored sign-in to a private-LAN `http://` server opens without the unencrypted-connection warning when the server answers as the same server; a new sign-in to it asks again.
- **Q12. The couldn't-check screen.** The matching sign-in sentence, "Try again" (primary, focused) and "Change server" (quiet, last); no new words.
- **Q13. The warning on the way back.** When the server ends a plain-HTTP sign-in at launch, step 1 opens with the warning open, Cancel focused.

## Settled, no longer awaiting

- The rail's look and entries, how many posters show beside it, and what Back does on Home: approved with T1-08 on 2026-11-20 (T1-08's evidence; T1-29 item 5).
- What Menu or Info does on a Continue watching card: `docs/specs/decisions-direction-2026-11-22.md` §2.
