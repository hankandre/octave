# Launch scope review, 2026-11-22

A Product Owner pass over every open task in phases T3 to T11, judged against `PRODUCT.md`. The owner can veto any line. The decisions and their reasons are also in `tasks/product-owner-log.md` (the section of the same date).

## What launch means

Launch is the Android TV app released on the Play Store (the end of phase T11), and it is:

- **Usable.** A viewer signs in to Jellyfin or Jellyscale, reaches Home, their libraries, search and a title's page, plays the original file with every conversion shown and its reason, resumes, and has the settings the app needs.
- **Safe.** The hard rules of `AGENTS.md` and `docs/security.md` hold, and nothing opens a path into the home network or leaks local information.
- **Marketable.** It has what a Play Store release needs: a private signing key, the listing, Google's TV quality rules, licences, and D-pad accessibility.

## Counts

97 tasks in T3 to T11 were open.

| Outcome | Tasks |
|---|---|
| Needed for launch (kept) | 89 |
| Moved after launch (to T12) | 8 |
| Dismissed | 0 |

Three of the 89 were not judged because they are being built or shipped now (T3-08, T3-31, T3-27). Seven of the 89 wait for Jellyscale and do not hold the release back; see the first owner question.

**What this says.** The list is mostly product already. Almost every open task traces to a sentence in `PRODUCT.md`, a hard rule, or a condition of decision 0004. The work that was pulling attention away sat at the end of T3 (checks on checks), and that is what moved. Nothing was dismissed because no open task is foreign to Octave's purpose; two candidates are named in the owner questions.

**One fix to the order.** Nine launch tasks were not on the path to the release at all: nothing waited for them, so the release could have gone out without them. The dogfood week (T10-05) now waits for them.

## The launch list

**T3, foundations (17)**
T3-08 rows and cards whose focus never jumps · T3-09 the app shell and side rail · T3-36 keep focus when a remote or keyboard connects · T3-34 icons · T3-35 the Signal loader · T3-11 artwork through the authenticated client · T3-31 run the APK checks before an install · T3-37 keep addresses and host paths out of the TV scripts' output · T3-33 a development build signs in only to a development server · T3-27 fixture ports per checkout · T3-21 sign with a private key · T3-17 Shield check: first focus · T3-07 capture and compare screens · T3-10 the scripted focus test · T3-12 the performance budget · T3-13 Baseline Profile · T3-14 image loading off the UI thread

**T4, sign-in (8)**
T4-02 choose a server · T4-03 Quick Connect by code or QR · T4-04 password fallback · T4-01 find servers on the home network · T4-05 stay signed in · T4-08 prove the session rules · T4-06 remembered accounts and Who's watching? · T4-07 sign-in wire test against Jellyscale

**T5, Home (5)**
T5-07 age titles out of Continue watching · T5-03 Home: resume in one press · T5-04 empty, loading and error states · T5-05 the Continue watching menu · T5-06 Shield check

**T6, library and search (7)**
T6-01 libraries in the rail · T6-02 the full grid · T6-03 sort, remembered · T6-04 letter rail · T6-06 search as you type · T6-07 voice search · T6-08 Shield check

**T7, detail (6)**
T7-01 movie page · T7-02 series page · T7-03 episode page · T7-04 watched and favourite · T7-05 pick a version and audio track · T7-06 cast and file details

**T8, player (21)**
T8-01 the player module's seam · T8-25 fixed error sentences · T8-02 direct play with Media3 · T8-03 a viewing with playstate · T8-04 the player screen · T8-05 hold to scrub · T8-06 the info sheet · T8-07 report what the device decodes · T8-23 judge every conversion answer · T8-08 converted streams through the validating parser · T8-09 show every conversion with its reason · T8-10 tracks on the server's defaults · T8-11 subtitles drawn on the device · T8-12 change tracks on a converted session · T8-13 remember choices for a series · T8-14 skip intros and credits · T8-15 next episode after a countdown · T8-17 refusals and errors in plain words · T8-18 streaming limits · T8-20 the direct-play tripwire · T8-21 Shield check: the playback gate

**T9, settings (6)**
T9-02 store preferences · T9-09 account settings on the server · T9-03 Settings: playback and Home · T9-04 languages · T9-05 manage accounts · T9-06 About, licences and diagnostics

**T10, Jellyscale (12)**
T10-01 one required Jellyscale job · T10-02 follow a canary token through a journey · T10-03 audit every endpoint · T10-04 recover when a sign-in ends · T10-05 dogfood week · and seven that each wait for a Jellyscale issue and hold nothing back: T10-06 Quick Connect · T10-07 a show once in Recently added · T10-08 conversion · T10-09 letter rail · T10-10 skip intros · T10-12 series choices · T10-13 next episodes

**T11, release (7)**
T11-01 the listing and the publishing account · T11-02 Google's TV quality rules · T11-03 the Play bundle · T11-04 sign and publish from CI · T11-05 licences and the source offer · T11-06 the 1 GB device check · T11-07 publish to the Play TV track

## Moved after launch

| Task | Why it can wait |
|---|---|
| T6-05 Filter a library by unwatched and favourites | `PRODUCT.md`'s browsing list has sort and the letter rail, not filters. Useful, not needed to find and play a title. |
| T8-16 Scrub previews from trickplay | Hold-to-scrub (T8-05) already shows the time while seeking. Pictures above the scrubber are comfort. |
| T10-11 Scrub previews on Jellyscale | Follows T8-16. |
| T8-19 Open a title from a link | Nothing at launch makes such a link. Its first user is Watch Next on the launcher (T12-03), which is already after launch. |
| T11-08 Test focus on a Fire TV device | Launch is the Play Store. `PRODUCT.md` promises Fire TV only after this test, so it gates Fire TV, not launch. |
| T3-18 Measure the browse rows' look trade-offs | Decision 0004's addendum calls this a later refinement. The look chosen there already met the frame and memory numbers. |
| T3-38 T3 hardening: the review lows | See the next section. |
| T3-32 Shorten the manifest check's allowed lists | See the next section. |

## Dismissed

None. See owner question 3 for two candidates.

## Security work set aside, and why that is safe

The owner's review rule: only a finding that opens a path into the home network, or leaks local information, holds back an install on a real TV.

- **T3-38, the T3 review lows.** These are the small findings left over from five reviews. Each was judged when it was logged as neither kind of finding, which is why they were gathered into one task. They tighten rules that already hold: stranger spellings of a request path, limits on a very large server answer, stricter readers in the build checks, and wording in the security documents. The rules they tighten stay in force and stay tested. One thing to know: it includes making `docs/security.md` say exactly what is built and no more, so until it runs that document slightly overstates a few checks.
- **T3-32, the manifest check's lists.** The release app already asks for only two permissions and no queries. This task shortens the list the check allows, so a permission added by mistake later would be caught sooner. The app itself does not change. Google's listing review (T11-02, T11-07) shows the permissions before a release.

Both stay on the list in T12 and can run earlier in a lane that has no product task ready.

**Security tasks kept, with the kind of gate each is:**

| Task | Kind |
|---|---|
| T3-31 APK checks before an install | Path into the home network (not judged in this pass; shipping now) |
| T3-21 private signing key | Path into the home network: a build signed with the public debug key can be replaced by anyone |
| T3-33 development builds and development servers | Enforces the hard rule of the same name; path into the home network through a debug connection |
| T3-37 addresses and host paths out of script output | Leak of local information |
| T3-11 artwork through the authenticated client | Enforces the hard rule on artwork and the header |
| T4-05, T4-08 stay signed in; the session rules | Enforce the token rules of decision 0005; leak of a credential |
| T8-08 the validating HLS parser | Enforces the hard rule on playlists; path into the home network |
| T8-25 fixed error sentences | Leak of local information (a raw error can carry an address) |
| T4-07, T10-01, T10-02 wire tests and the canary token | Enforce "no request without the header, no token in a URL"; leak of a credential |

## Owner questions

1. **Does the Play release wait for Jellyscale?** Seven tasks (T10-06, -07, -08, -09, -10, -12, -13) each wait for a Jellyscale issue. Today nothing holds the release back for them, and on Jellyscale each missing feature stays hidden. *Recommendation:* do not hold the release for them as a group. Let the dogfood week decide: if an evening on Jellyscale needed another client because of one of these gaps, that task becomes a launch task. The two most likely are next episodes (T10-13, issue #101) and conversion of files the TV cannot decode (T10-08, issue #224).
2. **`PRODUCT.md`'s "Later, by evidence" list.** It does not yet name library filters, scrub previews or links. *Recommendation:* add them to that sentence. The wording is the owner's, so it is not changed here.
3. **Two candidates to dismiss.** T3-18 (measure four look trade-offs for the owner to choose) and T12-08 (extras, genre browsing, spoiler protection and SyncPlay). *Recommendation:* keep T3-18 after launch, since the addendum to decision 0004 promised it; split or drop T12-08 only when use shows which part anyone wants.
4. **The Continue watching menu (T5-05).** The owner decided the menu ships now without Remove, but the task is still recorded as waiting for Jellyscale #233. *Recommendation:* the next pass edits T5-05 to match that decision, citing `docs/specs/decisions-direction-2026-11-22.md`, so the menu is not held back.
5. **The Signal loader (T3-35) at launch.** Kept, because `DESIGN.md` names it as the loading indicator and it is the first thing a viewer sees. *Recommendation:* keep; say so if a plain loader at launch is acceptable and it should move.
