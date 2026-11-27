# Product Owner calls on T4-06's design, 2026-11-26

These are **not the owner's words**. They are the Product Owner's calls on the T4-06 design brief
(`docs/specs/design/T4-06/brief.md`, commit 2ae361b5), made under the delegation of
`docs/specs/decisions-owner-chat-2026-11-25.md` (1), on Opus at the coordinator's request where the agent file names
Fable for a direction call. The owner can veto any of them, and a veto is final. They are logged in
`tasks/product-owner-log.md`, "2026-11-26, T4-06 design ruling".

The aim: the owner, dogfooding with one account and no way to sign out or change server, gets a safe account
switch and "Add account" soon. So T4-06 is split. **T4-06** builds everything that needs no native change and no
decision record. **T4-10** (new) builds what needs a stored, non-secret account list, and starts with that
decision record.

## Probes before ruling

- **X4, the Quick Connect DeviceId.** `packages/core/src/jellyfin/gateway.ts:75` and `:357-358`: every Quick Connect
  sign-in from one install to one server uses `deriveDeviceId(installId, serverId, "#quick-connect")`, one DeviceId.
  Jellyfin `Emby.Server.Implementations/Session/SessionManager.cs`, `GetAuthorizationToken`, read at `v10.11.7`
  (lines 1653-1683) and `v12.4` (lines 1786-1815): before issuing a token it logs out the devices that match
  **both** `DeviceId = deviceId` and `UserId = user.Id` ("Logout any existing sessions for the user on this
  device"). So:
  - **Proven by reading the source, not by a wire run:** a second Quick Connect sign-in as a *different* user does
    not revoke the first user's token on Jellyfin 10.11.7 or 12.4. The backlog line from T4-03 (line 391) was
    wrong on this point. B24 holds as the code stands, for Jellyfin.
  - **Proven the same way:** a repeat sign-in as the *same* user with the same DeviceId (Quick Connect then Quick
    Connect, or password then password with the same name) revokes that user's earlier token on the server the
    moment the new one is issued.
  - **Not proven:** Jellyscale's rule (not read); and on 10.11.7 the live session is keyed by app and DeviceId only
    (`GetSessionKey(appName, deviceId)`, line 486; 12.4 adds the user, line 481), so two Quick Connect accounts on
    one TV share one live server session there, and one account's logout calls `ReportSessionEnded` on it. That
    ends a live session object, not a token; what it does to playstate and `GET /Sessions?deviceId` is unverified.
- **X3, one record hiding others.** `modules/session/.../http/SessionTransport.kt:175-195`: `restore()` opens every
  readable record newest first and stops at the first one it keeps unopened (a Keystore or file error, or an
  address a development build refuses); `listed()` then drops every session not newer than it. A corrupt record
  is deleted and the walk goes on. Confirmed. The core (`restore-session.ts:27`) adopts only the first listed.
- **X5, the facts a tile needs.** Confirmed: `restoreSessions` gives `{ session, server, deviceId, userId, serverId,
  userName? }` and no server name; `endSession` deletes the record (`forgetAndTake`, `SessionTransport.kt:161`), so
  a signed-out or revoked account leaves nothing; the preferences record may hold no URL or user id
  (`packages/core/src/preference-store.ts:10-12`); nothing records the account used last.
- **The repeat sign-in.** `SessionTransport.kt:98-110` (`keep`): a new sign-in of an already saved account
  overwrites that account's record and makes every older entry stop naming it, so ending the older session later
  deletes nothing stored.

## 1. T4-06 is split (scope)

- **T4-06** keeps acceptance items 1 to 5 and 7, and gains the calls below. Its old item 6 (the signed-out tile)
  moves to T4-10. It needs no native method, no change to a result's shape and no decision record. If its spec
  finds it needs one, the question returns here; it does not grow into T4-10.
- **T4-10, "Keep a list of saved accounts, signed-out ones included"**, in the `native-session` lane, depends on
  T4-06. Its first milestone is a decision record: where a non-secret account list lives (server name, server
  address, server id, user id, user name, signed in or out, last used), what reads it, and how `restoreSessions`
  changes (X3). Either answer is an architecture change: a new native store or method, or relaxing the
  preferences record's "no URL, no user id" rule. **Who writes it:** T4-10's refiner drafts it as decision 0006 or
  an amendment to 0005; the Product Owner checks it on Fable; **the owner accepts it**, because it keeps user ids
  and server addresses outside the Keystore record and changes `docs/security.md`. No T4-10 code starts before.
- T9-05 (Sign out leaves a "Signed out" tile) now also depends on T4-10.

## 2. The conflicts

- **X1, presses to resume.** Accepted: 1 press with one signed-in account, 2 with two or more (tile, then Resume).
  T4-06's pull request rewords that row of `PRODUCT.md`'s success measures. Not chosen: auto-opening the last used
  account, which `DESIGN.md` 7.21 and the brief's "never an automatic choice" rule out.
- **X2, a failed switch.** As recommended (mockup 16). After a choice on the picker: "Loading…", then the matching
  sign-in sentence, "Try again" (focused) and a quiet "Who's watching?". Back on "Loading…" or on that screen, and
  the quiet button, return to the picker with focus on the chosen tile. The one-account launch keeps T4-05's
  screen ("Change server", Back leaves the app); `DESIGN.md` 7.20's two rules are scoped to it.
- **X3.** Not fixed in T4-06: it needs a native change. Until T4-10, an account whose record cannot be opened at
  this launch has no tile this launch; nothing is deleted, and it returns at a later launch. If only one account
  is left listed, the app opens it (item 1). T4-10 fixes it with its decision record.
- **X4.** On Jellyfin it does not break item 4 (probe above). T4-06 gains an item that the wire test proves two
  Quick Connect users on one server stay signed in against the pinned Jellyfin 10.11 and 12, and records what
  Jellyscale does; if Jellyscale signs the first one out, a Jellyscale issue is filed (`from:fluster`) and the
  item names it. The shared live session on 10.11 goes to the backlog.
- **X5.** T4-06 shows only what `restoreSessions` gives: signed-in accounts, with the user's name and the server's
  address. Server names, signed-out tiles and the account used last are T4-10's.

## 3. The behaviours the acceptance did not cover

Taken as the brief recommends, with these changes:

- **B7, opening focus at launch:** the first tile, until T4-10 records the account used last. From the rail: the
  active account's tile (B14).
- **B8, order:** by user name, then server address, compared without case. It needs no stored order, never moves
  a tile when someone signs in again, and adds a new account in its place. This replaces "order first added";
  T4-10 keeps it.
- **B9:** no request for any account before a choice. Only the chosen one is checked, by T4-05's rule (the probe in
  this launch must answer with the record's server id; a private-LAN `http://` server opens with no dialog under
  that condition, as T4-05 Q11 reads decision 0001).
- **B4, B26 to B30, B32:** T4-10's. In T4-06 a signed-out account has no tile.
- **B31 in T4-06:** a switch that finds the sign-in ended by the server goes to sign-in for that server, as T4-05
  built it; Back from sign-in's first step returns to the picker, where that account no longer has a tile. Accepted
  until T4-10, which keeps the tile as "Signed out".
- **B25, the abandoned repeat sign-in. This corrects call 8 of `decisions-product-owner-2026-11-26d.md`.** Call 8
  kept "the earlier saved sign-in". On Jellyfin that sign-in is already revoked by the server when the repeat
  sign-in with the same DeviceId succeeds, and the native store has already replaced its record. So: when the
  viewer leaves a sign-in and the answer arrives late, and it is for an account already saved (same server id and
  user id), the late session is **kept** as that account's sign-in and nothing switches; a late session for an
  account not saved is ended, as T4-04 C10 says. After any repeat sign-in of a saved account, the session it
  replaced is ended; its record is no longer named, so nothing stored is deleted, and a token from the other
  sign-in method (another DeviceId) is revoked on the server rather than left behind.
- **B13, B15, B18, B21, B22, B23, B33 to B38:** as the brief recommends.

## 4. The open choices

- **O1:** wrapped rows (mockups 06, 07).
- **O2:** centred (01, 04).
- **O3:** "Who's watching?" only after a failed switch (16). "Add account" on the picker reaches another server.
- **O4:** no mark on the active account.
- **O5:** with no user name from the server, the disc shows Tabler's `user` icon and the name line reads
  "Account" (new use of an existing word). TalkBack reads "Account, {server}".
- **O6:** T4-05's "Loading…", unchanged.
- **The server line in T4-06:** the server's address as the origin chip shows it, without the scheme, in
  `typeMono`, `text3` going to `text2` on focus, cut with "…". T4-10 replaces it with the server's name.
- **The tile's TalkBack label:** "{name}, {server}". Layout, colours and focus as brief section 4 recommends, less
  the signed-out look, which is T4-10's.

## 5. Account privacy, plainly

`PRODUCT.md` ("Better than a streaming service", 5) says remembering several accounts must not let one person open
another's. **T4-06 does not meet that, and neither does T4-10.** Without a PIN (T12-01), anyone holding the remote
can select any signed-in tile and see that account's libraries, history and settings, and play as that account.
What T4-06 does protect:

- one account's screens, rows, artwork and settings never show under another account, even for a frame (items 5
  and 7);
- a request for one account never carries another's session or goes to another's server;
- no tile, label or TalkBack line shows a token, a user id or a server id;
- adding or switching an account never signs anyone out.

The picker must not suggest that a tile is protected: no lock icon, no "private". The owner is asked below
whether T12-01 should come sooner.

## 6. For the owner (none blocks T4-06)

1. Two people on one TV now take two presses to resume (tile, then Resume); one person still takes one. Fine?
   Default: yes.
2. Until a PIN exists, anyone with the remote can open any saved account. Should a PIN (T12-01) move up?
   Default: no, it stays after launch.
3. The decision record T4-10 starts with keeps account names, server addresses and user ids on the TV outside
   the encrypted sign-in record. You accept that record before T4-10's code. Default: the refiner recommends.
4. Until T9-05, adding an account is the only way to another server, and the old one stays a tile. Fine for now?
   Default: yes.
