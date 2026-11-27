# T4-06 design brief: "Who's watching?"

Status: a proposal for the Product Owner. The owner may veto from the mockups.

**Superseded in part:** after the owner's feedback on mockup 16, `../full-screen-states/brief.md` sets how every loading and failure screen looks and words itself. It replaces the composition and wording in B34 and section 6, and the look of mockups 10, 15 and 17. Mockup 16 now shows the new pattern. The behaviour here is otherwise unchanged.

**The viewer's goal:** get to my own Home, with my own progress and settings, in as few presses as possible. A household with one account must never notice that accounts exist.

How to read this:

- **A1 to A7** are T4-06's acceptance items, in the order `pnpm task show T4-06` lists them.
- **†** marks a behaviour that the acceptance does not cover, or that conflicts with something. Each one is listed again in section 3.
- "01" and so on name the mockups in this folder (section 7).

| | Acceptance, in short |
|---|---|
| A1 | One signed-in account opens straight to its Home |
| A2 | Two or more open on "Who's watching?"; one press on a tile opens that Home |
| A3 | An account is one user on one server, saved by server id; it sees only its own server's libraries |
| A4 | The rail's account entry opens the same screen; Add account signs nobody out |
| A5 | Switching drops the previous account's cached screens |
| A6 | A signed-out tile says so in words and opens sign-in for that user and server |
| A7 | Switching calls `useAccount` with the new account's preference source |

## 1. The experience

"Signed in" counts only accounts with a stored sign-in. A signed-out tile never counts.

### 1.1 First run

The viewer opens Octave for the first time, signs in, and lands on Home.

| # | Behaviour | Mockup | Serves |
|---|---|---|---|
| B1 | With no saved account, launch opens sign-in's first step. "Who's watching?" does not appear. | T4-02 captures | A1 |
| B2 | After the first sign-in, Home opens. "Who's watching?" does not appear in between. | 11 | A1 |

**Never:** a picker with one tile, or a picker with only "Add account".

### 1.2 An ordinary evening, one account

The viewer opens Octave, sees "Loading…", then Home with focus on Resume. One press plays.

| # | Behaviour | Mockup | Serves |
|---|---|---|---|
| B3 | With exactly one signed-in account, launch shows "Loading…" and then that account's Home, with focus on the hero's primary action. No key is needed. | 10, 11 | A1 |
| B4† | B3 also holds when other saved accounts are signed out. They stay reachable from the rail. | 11, then 13 | A1 |
| B5 | The collapsed rail's account entry shows the active account's initial. Open, it shows the name. | 11, 12 | A4 |

**Never:** "Who's watching?" at launch for one signed-in account.

### 1.3 A household: launch

The viewer opens Octave and sees "Who's watching?". Focus is already on whoever watched last. Select shows "Loading…", then that person's Home. A second select resumes.

| # | Behaviour | Mockup | Serves |
|---|---|---|---|
| B6 | With two or more signed-in accounts, launch opens "Who's watching?" with no rail. It shows every saved account, then "Add account". | 01, 04 | A2 |
| B7† | Opening focus is on the account used last on this TV. If that one is signed out or unknown, it is on the first signed-in tile. | 01 | A2 |
| B8† | Tiles keep the order in which the accounts were first added. Using, switching or signing in again never moves a tile. | 06 | A2 |
| B9† | Before a choice, Octave sends no request for any account. It checks only the chosen one. | 01 | A2, A3 |
| B10 | One select on a signed-in tile shows "Loading…" and then that account's Home, with opening focus on its primary action. Nothing else is asked. | 15, 11 | A2 |
| B11 | The Home, libraries, artwork, rail initial and per-account settings all belong to the chosen account. None of the settings or content of another account appears, even for one frame. | 11 | A3, A5, A7 |
| B12 | Back on the launch picker leaves the app, with no question. | 01 | A2 |
| B13† | The picker appears at a fresh launch only. Coming back to an app that is still running, or finishing a film, does not show it. | none | A2 |

**Never:** a countdown or an automatic choice; a tile that moves while focus is on the screen.

### 1.4 A household: switching during the evening

From Home the viewer presses Left, then Down to the name at the bottom of the rail, then select. "Who's watching?" appears with their own tile focused. Right, then select, opens the other person's Home.

| # | Behaviour | Mockup | Serves |
|---|---|---|---|
| B14 | Select on the rail's account entry opens "Who's watching?", with the collapsed rail beside it and focus on the active account's tile. This works with any number of accounts, one included. | 12, 13 | A4 |
| B15† | Select on the active account's own tile goes to Home with no "Loading…" and no server check. It is not a switch. | 13 | A2 |
| B16 | Select on another signed-in tile shows "Loading…" and then that account's Home. The previous account's screens, rows, scroll places, focus memory and artwork are gone. Switching back loads again. | 15, 11 | A2, A5 |
| B17 | The previous account stays signed in. Its tile opens it again with one select. | 13 | A4 |
| B18† | The previous account stays the active one until the new one has been checked. If the switch fails or is cancelled, the previous account's tile and settings are unchanged. | 15, 16 | A5, A7 |
| B19 | From the rail, the first Back on the picker opens the rail on the account entry. A second Back goes to the active account's Home. (This is how T3-09 already works.) | 14 | A4 |

**Never:** a switch that signs anyone out; one account's cards under another account's initial.

### 1.5 Adding an account

The viewer chooses "Add account" and signs in as usual. If they change their mind, Back takes them to where they were.

| # | Behaviour | Mockup | Serves |
|---|---|---|---|
| B20 | Select on "Add account" opens sign-in's first step, with no rail. Nobody is signed out. | 03; T4-02 captures | A4 |
| B21† | Back from that first step, with nothing left to close or stop, returns to the picker with focus on "Add account". A rail that was there is there again. It does not leave the app. | 03 | A4 |
| B22† | A finished sign-in saves the account, makes it active and opens its Home. At the next launch it is a tile, last in the order. | 11 | A3, A4 |
| B23† | Signing in as a user who is already saved on that server (same server id and user) makes no second tile. The existing tile is signed in again, in its old place. | 01 | A3 |
| B24† | **Adding or re-entering an account never signs another one out, here or on the server.** This includes two Quick Connect sign-ins to one server. | 13 | A4 |
| B25† | Leaving a sign-in for an already saved account keeps that account's earlier sign-in, including when the server's answer arrives late. | none | A4 |

**Never:** two tiles for one user on one server; two users merged because their names match.

### 1.6 A signed-out account

A tile says "Signed out". Select goes to sign-in for that server. Until T9-05, only the server can cause this, by ending the sign-in.

| # | Behaviour | Mockup | Serves |
|---|---|---|---|
| B26† | A signed-out account keeps its tile, in place, across launches. The tile shows "Signed out" in words, focused or not. TalkBack reads name, server, "Signed out". | 04, 05 | A6 |
| B27 | Select on it opens sign-in with its server chosen: the Quick Connect step for HTTPS; for plain HTTP at home, first the unencrypted-connection warning with Cancel focused. "Use a password" opens with the username filled (T4-05 D8). | T4-05 captures | A6 |
| B28† | Back steps back as sign-in does today. Back from sign-in's first step returns to the picker, with focus on that tile. | 05 | A6 |
| B29† | A finished sign-in as that user turns the same tile back into a signed-in one and opens its Home. | 11 | A6 |
| B30† | If a different user approves or signs in, that user is saved and opened as their own account. The signed-out tile stays signed out. | none | A3, A6 |
| B31† | If a chosen tile turns out to be ended by the server (the confirmed revoke of T4-05), Octave goes to sign-in as in B27. Back reaches the picker, where that tile now says "Signed out". | 05 | A6 |
| B32† | With no signed-in account left, launch opens sign-in, not the picker. A sole account the server ended behaves as T4-05 built it. | T4-05 captures | A1, A6 |

**Never:** a tile that disappears because the server ended its sign-in; "Signed out" shown because a server did not answer.

### 1.7 A server that does not answer

At launch with one account, nothing changes from today. After choosing a tile, the viewer sees the same sentence, can try again, and can always get back to choose someone else.

| # | Behaviour | Mockup | Serves |
|---|---|---|---|
| B33 | One account at launch: "Loading…", then the failure sentence with "Try again" and "Change server". Back leaves the app (T4-05, unchanged). | 10, 17 | A1 |
| B34† | After a tile is chosen: "Loading…", then the matching sentence, "Try again" (focused) and "Who's watching?" (quiet). | 15, 16 | A2 |
| B35† | "Try again" checks the same account behind "Loading…". | 16 | A2 |
| B36† | Back on "Loading…" or on the failure screen, and the "Who's watching?" button, return to the picker with focus on the chosen tile. The rail is there if it was before. | 16, 13 | A2 |
| B37† | A check the viewer has left never switches the account later, whatever answer arrives. | none | A2, A5 |
| B38† | A failed check keeps the account signed in. It deletes nothing and blocks no other tile. | 04 | A3, A6 |

**Never:** a dead end whose only way out is to quit or to start a new sign-in; a retry that Octave starts by itself.

### 1.8 What must never happen, anywhere

| # | Behaviour | Serves |
|---|---|---|
| B39 | A request for one account never carries another account's session, or goes to another account's server. | A3 |
| B40 | No tile, label or TalkBack line shows a token, a user id or a server id. | A3 |
| B41† | One account that cannot be read or opened never hides another account's tile. | A2, A3 |

## 2. What this screen cannot do: sign out and remove

- A signed-in viewer **cannot sign out or remove an account here.** They can switch, or add another account.
- **No hold-select menu, no edit button.** Select held on a tile does what select does.
- **T9-05 owns** Sign out, Remove, the Remove dialog, "unencrypted" in words, and where a viewer lands after signing out. All of it lives in Settings, Accounts. B26 draws the tile that T9-05's Sign out will leave behind.
- Until T9-05, the only way to remove a saved account is to clear the app's data.
- There is no PIN: anyone with the remote can open any tile. `PRODUCT.md` "Better than a streaming service", point 5, says remembering several accounts must not let one person open another's. T12-01 holds that question. This design must not suggest that a tile is protected.

## 3. For the Product Owner, before the spec

### 3.1 Conflicts

| # | Conflict | Behaviours | Recommendation |
|---|---|---|---|
| X1 | `PRODUCT.md`'s success measure is "1 press from launch to resuming". A2 makes it 2 for a household (tile, Resume). | B6, B10 | Accept 2 for two or more accounts and reword the measure. |
| X2 | `DESIGN.md` 7.20 says Back on "Loading…" and on the couldn't-check screen leaves the app, and that screen offers "Change server". After a choice on the picker, both strand the viewer: one exits, the other starts a new sign-in. | B34, B36 | Scope those two rules to a one-account launch. Drawn: 16 (recommended), 17 (as built). |
| X3 | T4-05's restore stops at the first record it cannot open, and opens nothing older. With several accounts, one bad record would hide others. | B41 | Decide this in the spec. The reason for the rule was to stop an older account opening silently; a viewer's own choice is not silent. A native change needs a decision 0005 amendment. |
| X4 | Every Quick Connect sign-in from one TV to one server uses one DeviceId, so a second account can end the first one's sign-in on the server (backlog, T4-03; not re-verified here). | B24 | Make B24 an acceptance item. It breaks A4 as the code stands. |
| X5 | The tile needs facts that a signed-out account, and perhaps a signed-in one, does not keep. `restoreSessions` returns no server name. A revoke or sign-out deletes the record. The preferences store refuses URLs (backlog, T4-02). Nothing found records which account was used last or the order accounts were added. | B6 to B8, B26, B27 | The spec first says where a non-secret account list lives. A new native method or event needs a decision record. |

### 3.2 Behaviour the acceptance does not cover

| Behaviours | Gap | Recommendation |
|---|---|---|
| B4, B32 | Signed-out accounts beside one or no signed-in account | One: open its Home. None: sign-in, as T9-05 item 4 expects. With none, signed-out tiles are unreachable until one account signs in. |
| B7, B8 | Opening focus and tile order | Last used; order first added (`DESIGN.md` principle 8). `restoreSessions` lists newest record first, so do not reuse that order. |
| B9 | When accounts are checked | Only the chosen one |
| B13 | What "the app opens" means | A fresh launch only |
| B15 | Choosing the active account | No reload, no check |
| B18, B37 | A failed or cancelled switch | The previous account stays active until the new one is checked. A5's "drops" happens at success. |
| B21, B28 | Back out of sign-in reached from the picker | Return to the picker |
| B22, B23, B29, B30 | The result of each sign-in | As written |
| B25 | The abandoned repeat sign-in | Already given to T4-06's spec (`decisions-product-owner-2026-11-26d.md` §8) |
| B26 | The tile survives a restart | Add it to A6 |
| B31 | A revoke found while switching | Same path as a signed-out tile. A revoke during a session stays T4-08's. |
| B34 to B36, B38 | The failed switch | Add one acceptance item |

A7 names switching only. T4-05 already wires `useAccount` at restore and sign-in, so B11 needs no new item for those.

## 4. Layout (recommendation)

**One question in the middle of a dark room, and a face-sized disc for each person.** Colour comes only from artwork and this screen has none, so it stays colourless: no per-person colours, no avatars from outside.

- **Heading:** "Who's watching?", `typeTitle`, centred. No line above or below it.
- **Tile:** a `personDisc` (200) circle with the initial in `typeHero`; `space5` below it, the name (`typeLabel`) and the server name (`typeMeta`), one line each, cut with "…". The tile is 248 (`posterW`) wide. Tiles are `space5` (24) apart, rows `space7` (48).
- **Colours:** signed in: `surface3` disc, `text1` initial. Add account: `fillSecondary` disc, Tabler `plus` (a new glyph, `0xeb0b`). Signed out: an empty disc with a 2 px `lineStrong` edge, a `text3` initial and "Signed out" in `text1`. The words carry the state; the empty disc only helps.
- **Focus:** the card rule. The round two-tone ring, the lift and `shadowLift` go on the disc. The name goes from `text2` to `text1`, the server from `text3` to `text2`. The text does not scale.
- **Many accounts:** six to a row (1,608 wide, so it clears the collapsed rail), wrapping, each row centred. The block is centred vertically. Past two rows it scrolls vertically and keeps the focused tile and its ring whole.
- **Same place with and without the rail:** it is centred on the screen, so tiles do not move between launch and the rail's entry.
- **Motion:** only the focus lift (`durQuick`; none with reduced motion).
- **Long names:** TalkBack reads the full text.
- **† Two tiles with the same name and server name** (or names cut to look the same): add the server's address as a third line in `typeMono`, only on those tiles. Not drawn. It would not separate two long user names on one server.
- **† No user name from the server:** show the `user` icon in the disc. What the name line says is open (O5).

### Alternatives drawn

| Choice | Recommended | Alternative | Why |
|---|---|---|---|
| Many accounts | Wrapped rows (06, 07) | One scrolling row (08) | Up to 6 tiles the two look the same. Beyond that, wrapping shows everyone and "Add account" at once. A row is simpler (one axis) but hides people. |
| Alignment | Centred (01, 04) | Left, like sign-in (09) | This screen is a choice between equals, not a form. Left leaves two or three tiles in one corner. |
| Failed switch | "Who's watching?" button (16) | As built, "Change server" (17) | X2 |
| Rail on the picker | Rail when entered from it (13, 14) | No rail, so one Back returns Home (looks like 01) | The first is built (T3-09). The second saves one press but gives the same screen another Back rule. |

## 5. Remote keys

Opening focus: at launch, the last used tile (B7); from the rail, the active tile (B14); after a return, the tile the viewer left from (B21, B28, B36).

| Focus on | Left | Right | Up / Down | Select | Back |
|---|---|---|---|---|---|
| Tile, first in its row, launch | Stays | Next tile | Nearest tile by horizontal centre in that row; stays if none | By tile, below | Leaves the app |
| Tile, first in its row, from rail | Opens the rail on the account entry | Next tile | Same | By tile | Opens the rail on the account entry |
| Tile in the middle of a row | Previous | Next | Same | By tile | As above, by entry |
| Tile, last in its row | Previous | Stays; no wrap to the next row | Same | By tile | As above |
| Rail's account entry, rail open on the picker | Stays | Back to the tile | Up: Settings. Down: stays | Closes the rail, back to the tile | Active account's Home |
| Other rail entry | Stays | Back to the tile | Moves in the rail | Opens that screen for the active account | As above |
| Rail's account entry, on another screen | Stays | Back to the content | Up: Settings. Down: stays | Opens the picker | As the rail does today |
| "Loading…" after a choice | Nothing to focus | | | Nothing | Picker, chosen tile (B36) |
| "Try again" | Stays | Stays | Down: the quiet button | Checks again | Picker, chosen tile |
| Quiet "Who's watching?" | Stays | Stays | Up: "Try again" | Picker, chosen tile | Same |
| Sign-in screens | As built | | | As built | As built, then B21 or B28 |

Select by tile: signed in, switch or open (B10, B15, B16); signed out, sign-in (B27); "Add account", sign-in's first step (B20).

Presses from Home to another account, with two libraries: Left, Down four times, select, Right, select: 8. Each extra library adds one Down.

## 6. Words

| Where | Words | Source |
|---|---|---|
| Heading, and the rail entry with no account | Who's watching? | `DESIGN.md` 7.1, 7.21 |
| Last tile | Add account | 7.21 |
| Signed-out tile | Signed out | 7.21, 10 |
| Checking | Loading… | 7.20, 10 |
| Failure | the matching sign-in sentence; Try again; Change server (one-account launch) | 10 |
| **Proposal:** quiet button after a failed switch | Who's watching? | Existing words, new use as a button |
| **Proposal:** TalkBack label of a tile | "{name}, {server}", plus ", Signed out" | New format, no new words |

## 7. Mockups

| File | Shows |
|---|---|
| `01-two-accounts.png` | Two accounts at launch, opening focus (recommended layout) |
| `02-focus-moved.png` | Focus on the second account |
| `03-add-account-focused.png` | "Add account" focused |
| `04-signed-out-not-focused.png` | A signed-out tile, not focused |
| `05-signed-out-focused.png` | The signed-out tile focused |
| `06-many-wrapped.png` | Eight accounts: long names; "Juniper" on two servers, the second focused |
| `07-many-wrapped-second-row.png` | Focus in the second row |
| `08-alt-many-one-row.png` | Alternative: one scrolling row |
| `09-alt-left-aligned.png` | Alternative: left-aligned |
| `10-launch-one-account-checking.png` | One account at launch, while checking |
| `11-launch-one-account-home.png` | Then its Home; the rail shows its initial |
| `12-rail-account-entry.png` | The rail open on the account entry |
| `13-picker-from-rail.png` | The picker from the rail, focus on the active account |
| `14-picker-back-opens-rail.png` | The first Back from there |
| `15-switching.png` | While the other account loads (the same screen as 10, on purpose) |
| `16-switch-failed.png` | Failed switch (recommended), drawn from `../full-screen-states/mockups.html?m=06-switch-failed` |
| `17-alt-switch-failed-as-built.png` | Failed switch with today's screen |

Sign-in is not redrawn because it does not change. See the captures under `docs/specs/captures/`: `T4-02/after-found-servers.png` (Add account's first step), `T4-05/after-revoked-password-prefilled.png` and `T4-05/after-revoked-unencrypted-dialog.png` (signed-out routes), and `T4-03/after-waiting-qr.png` (Quick Connect).

Source: `mockups.html?m=<file name without .png>`. It loads the repo's UI font and the installed Tabler font by relative path (`pnpm install` first, and allow file access in the browser). All names and art are invented.

The Home screens are a rough backdrop for the rail, not a Home design. The app passes no libraries or account to the rail yet. T4-06 has to pass the account; the "Movies" and "Shows" entries wait for T6-01. Primary buttons are drawn as built today; T3-41 will change an unfocused one.

### What the mockups cannot prove

- **Focus moves.** Where native focus really goes, above all between centred rows of different lengths, and from row two into the rail. This needs a D-pad run.
- **TV rendering.** This is desktop Chrome at 1 canvas px to 1 image px. React Native lays out in half-size dp with its own font drawing, rounding, shadows and clipping. A round ring on a scaled view needs an emulator capture.
- **From the sofa.** Whether the empty disc reads as signed out, whether `text3` server names read at 3 m, and whether the ring is enough on a plain disc. Lifted blacks, overscan and smoothness need the Shield.
- **Time.** How long "Loading…" lasts (up to 5 s for each of two checks), flashes between screens, and the lift's motion.
- **TalkBack**, real names in other scripts, and initials from emoji.

## 8. Open choices

| # | Choice | Lean |
|---|---|---|
| O1 | Wrapped rows or one row | Wrapped |
| O2 | Centred or left | Centred |
| O3 | After a failed switch: "Who's watching?" or "Change server", or both | "Who's watching?" only; "Add account" there reaches another server |
| O4 | Mark the active account on the picker? | No. Opening focus and the rail's initial show it. A mark needs new words. |
| O5 | The name line when the server gave no user name | Needs words from the Product Owner |
| O6 | The "Loading…" screen | Keep T4-05's. Naming the account would help but adds words. T3-35's loader replaces it later. |

## 9. Sources

Android TV guidance, read 2026-11-26:

- Focus: only one element has focus at a time; scale and outline are focus indicators. <https://developer.android.com/design/ui/tv/guides/styles/focus-system>
- Navigation: always have an item in focus; with a left menu, Back focuses the current menu item; do not gate exit; no on-screen Back button; give each axis a job. <https://developer.android.com/training/tv/get-started/navigation>
- Drawer: its top section can switch profiles and its bottom section can hold a profile action. Octave keeps the account at the bottom (`DESIGN.md` 7.1). <https://developer.android.com/design/ui/tv/guides/components/navigation-drawer>
- Cards: 1:1 suits people (its example is cast and crew). <https://developer.android.com/design/ui/tv/guides/components/cards>

**Unverified:** I found no Android TV design page for a profile or account picker (one web search). The round tiles, centring and wrapping are this brief's judgement, not guidance. B19 follows the navigation page's Back rule only if the picker counts as a root screen, which is T3-09's reading; `DESIGN.md` 6 does not list it as one.

`frontend-design` shaped the restraint here (one thing to look at, no decoration). `impeccable` was used second, for its product-screen guidance only. Its launcher was not run, because it can download a binary.
