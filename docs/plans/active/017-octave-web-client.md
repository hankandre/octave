# 017: Octave as Jellyscale's web client

## Goal / Done when

A viewer opens Jellyscale in a browser at `/web/`, signs in through the server's OIDC (or a password on a plain Jellyfin server), and watches a film with the same rules the TV app keeps: the original file whenever the browser can take it, a server copy when it cannot, and every conversion named. Jellyscale ships it as its default web client, in place of jellyfin-web.

- [ ] A viewer signs in at `/web/` with OIDC against Jellyscale, and with a password against plain Jellyfin, and reaches Home.
- [ ] Every media request carries `Authorization`, and no media request carries a token in its URL: a wire test records zero `ApiKey`/`api_key` media requests, zero `Set-Cookie`, and zero followed redirects.
- [ ] A file the browser plays as it is plays directly; an MKV the browser cannot take is copied into fMP4 HLS, not re-encoded, and the player says "Repackaging on server, original quality: {reason}".
- [ ] Jellyscale's e2e tier drives Octave web and is green; `/web/` is a configuration value, with jellyfin-web still servable for rollback.
- [ ] A decision record replaces decision 0005's native-only token rule for the browser form, and `docs/security.md` states the web boundary with the test that proves it.
- [ ] `pnpm check` is green, and the Jellyscale checks the plan names are green.

## Context and domains touched

- **Server Connection & Identity** (DOMAINS §1): a browser session, OIDC, the token boundary. Decision 0005 governs today and is Android-shaped; `docs/security.md` §1 opens "This is Octave's security design for the TV app".
- **Player Engine** (DOMAINS §6): a third engine behind the existing `PlayerEngine` port. ARCHITECTURE invariant **I7** forbids any player path that cannot send the header "as a fallback or otherwise (a web video element, …)" (`ARCHITECTURE.md:258`), so the engine fetches and feeds Media Source Extensions itself.
- **Playback Negotiation** (DOMAINS §3) and **Playback Session** (DOMAINS §4) are reused unchanged: negotiation builds the URL, the session reducer runs the attempt.
- **App Shell & Presentation** (DOMAINS §8): the same screens and tokens, with pointer and keyboard added.
- **Distribution** (DOMAINS §9): static assets, versions, and what Jellyscale pins.

Jellyscale side, for the decisions this plan cannot make alone:

- `GET /` redirects to `/web/` and `/web/` is served from `WebDir` (`internal/api/server.go:184-187`), open to anyone (`docs/access.md`, "Served outside the table"). The image pins jellyfin-web today (JS-150, todo).
- Every media route needs a token (D-026, `docs/status.md:141`); a client that sends none is refused 401 and is not supported.
- Invariant 63 forbids a cookie **including one for the OIDC sign-in** (`DOMAINS.md:185`) and forbids `Access-Control-Allow-Credentials`, so OIDC must be a token flow.
- OIDC is not built and is written as "a login link on jellyfin-web's login page (branding disclaimer)" (JS-039, todo). That framing stops working the moment Octave is the web client, so JS-039 must be re-framed before T17-04 can finish.
- Video-and-audio **copy** into fMP4 HLS is built and cheap (`docs/status.md:7`), which is what lets an MKV play in a browser at original quality.

## Forced constraints

1. **No `<video src>`.** I7 decides it, and Jellyscale's token-on-every-request rule forces the same answer independently: a browser element cannot send a header, so the engine fetches every manifest, init segment and media segment itself and feeds MSE. JS passes only a plan (an item, a session id); no URL or header crosses into the element.
2. **The token lives in page memory.** A browser cannot keep it out of JavaScript the way Kotlin does. XSS becomes the boundary, so the page ships with a strict CSP, no third-party scripts and no analytics (PRODUCT principle 6). Nothing that is a credential is persisted; reload behaviour is decided in decision 0006, not assumed.
3. **Direct play on the web is MP4 and WebM.** MSE takes ISO BMFF and WebM, not Matroska. An MKV is a server copy into fMP4 HLS, which is original quality and honest copy. Anything the browser's decoders cannot take is a transcode with its reason shown.
4. **No Dolby Vision in any browser, and HDR10 only on some.** The web form converts more often than the Shield. That is acceptable only because the reason is shown; it must never become a silent quality drop.
5. **Quick Connect is unavailable on Jellyscale** (JS-037, todo), so the web form's first sign-in is a password, then OIDC. Quick Connect appears when the server has it.

## Dependencies

| Dependency | Check (primary source, 2026-11-26) | Verdict |
|---|---|---|
| `react-native-web` | npm `0.21.4` published 2026-10-08, canary `0.22.0-canary-20261120`; `necolas/react-native-web` not archived, 22,161 stars, pushed 2026-11-26; peer deps `react ^19`, `react-dom ^19`, `react-native *` | Adopt `~0.21.4`, the version Expo SDK 58 pins (`expo@58.0.26 bundledNativeModules.json`) |
| `react-dom` | Expo SDK 58 pins `19.3.0`, matching the app's React | Adopt `19.3.0` |
| HLS client | `hls.js` is mature but would be a second URL builder and its own retry logic, outside Playback Negotiation and outside the shared HLS vectors | **Not adopted.** The engine parses playlists with the same rules the shared vectors test. Revisit only if the milestone shows the effort is wrong; record the check if so |
| Media Source Extensions | W3C API, no dependency; `ManagedMediaSource` is required on iPhone (iOS 17.1+) | No dependency; the capability probe reports what the browser has |

## Milestones

0. **Falsifier: does the existing app tree render in a browser?** Build `apps/tv` with `expo export --platform web` as it stands, with only the two dependencies above, and open the output in Chromium against the Jellyscale fixtures image. Drive the rail and one row with the keyboard, capture at 1920×1080, and record first content, a 60 s idle memory figure and frame pacing with focus moving. Validation: the export succeeds, a row renders with artwork and a visible focus, and the figures are pasted into this plan. Model: opus. **Gate:** if the tree cannot render the rows and cards acceptably, the plan switches to a React DOM UI on `packages/core` before any T17 task is written, and this plan is revised rather than continued.
1. **Decision records and product text.** `docs/decisions/0006-web-token-boundary.md` replaces 0005's native-only rule for the browser form: where the token lives, what may never be persisted, reload and silent re-auth, CSP, and the test that proves no credential reaches a URL, a cookie or storage. `PRODUCT.md` gains the web form in its platform table and scopes "must not feel like a web page in a frame" to native shells. `DESIGN.md` gains the pointer and hover rules for the web form, with the TV still the reference. `docs/security.md` gains a web section. Validation: `gate: review`, and `pnpm lint:flow` unchanged. Model: fable for the decision, opus for the text.
2. **T17-01 The web host.** `*.web.ts` variants of the host ports: the transport (the existing `FetchTransport`, token in `#private`), WebCrypto, the install id (a v4 UUID in `localStorage`, never a secret), the preference store (device record in `localStorage`, account record on the server's display preferences as today), artwork (fetched with the header into a blob URL, cached, never an `<img>` pointed at the server), and the sign-in flow (password first). Validation: the host suites under Jest, and a Chromium run that signs in, renders Home's two rows and opens a detail page against the fixtures image. Model: opus.
3. **T17-02 The web engine.** A `PlayerEngine` implementation over MSE: `PlaybackInfo` → plan from the existing negotiation, a playlist parser that passes the shared HLS vectors, a range-capable segment fetcher through the authenticated transport, MP4/WebM direct play, fMP4 HLS for copy and transcode, WebVTT subtitles fetched through the same client, seek, buffering and recovery, all reported through the existing `PlayerEvent` stream so `PlaybackCoordinator` is untouched. Validation: the shared vectors pass in TypeScript; a new wire test `player-web` against Jellyscale records header-authorized media requests only; a Chromium e2e plays a direct MP4, a copied MKV and a transcode, seeks, and switches a subtitle. Model: opus.
4. **T17-03 Browse and input on the web form.** Pointer and hover rules from milestone 1, keyboard mapping (arrows, Enter, Escape, space), the rail, Home, the library grid with its letter rail, search, detail, and the player chrome; the 1920×1080 canvas scaled to the viewport; reduced motion. Validation: captures at 1920×1080 and a keyboard-driven focus script, reviewed against `DESIGN.md`. Model: sonnet with an opus review.
5. **T17-04 OIDC sign-in.** With Jellyscale: an authorization-code flow with PKCE, no cookie, the exchange server-side, and a Jellyfin-shaped token returned to the page; silent re-auth and sign-out per decision 0006. Password stays for plain Jellyfin; Quick Connect appears when the server advertises it. Validation: the wire test against Jellyscale with a test identity provider — no `Set-Cookie`, no token in a URL, header on every request, and sign-out revokes. Model: opus, with a fable review of the boundary.
6. **T17-05 Packaging and cutover.** Build and pin the static output; Jellyscale serves it at `/octave/`; its e2e tier drives Octave; then `/web/` moves by configuration with jellyfin-web still servable. Validation: Jellyscale's `test/e2e` green against Octave, both paths served, rollback is one value. Model: opus.
7. **T17-06 Hardening.** CSP and the XSS threat model written down, Safari and iPadOS figures, iPhone's `ManagedMediaSource` limit stated plainly, low-end browsers, accessibility, and performance budgets measured. Validation: the budgets recorded in this plan with their runs; a security review. Model: opus.

Each milestone's work gets its own spec in `docs/specs/<TASK-ID>.md` before implementation. The T17 tasks do not exist in `tasks/prd.json` yet: a Product Owner pass adds them, and this plan does not.

## What Jellyscale must change

- **JS-150** stops pinning jellyfin-web and pins Octave at `/web/` (or `/octave/` first, per milestone 6).
- **JS-039** is re-framed: OIDC is the web client's primary sign-in, not a branding link on jellyfin-web's login page, and its routes are co-designed with T17-04.
- **JS-122** (a settings page because jellyfin-web has nowhere for the track languages) is likely unnecessary once Octave web has a Settings screen; decide when T17-03 lands.
- **JS-037** (Quick Connect) stays for the TV; the web form does not need it.
- The **e2e tier** (`test/e2e/`, 10 browsers suites) moves from jellyfin-web to Octave. This is the real cost of "default", and it is also the proof.
- `compat/endpoints.yaml`'s `alias` rows exist only for jellyfin-web and are removed as it stops calling them; after the cutover they can be revisited as a group.

## Risks

- **`react-native-tvos` under Metro's web alias is unverified.** The app installs the TV fork under the name `react-native`; Expo resolves `react-native` to `react-native-web` for a web build, but whether the tvOS surface leaks through is exactly what milestone 0 measures. `@shopify/flash-list`, `react-native-reanimated` 4 and `react-native-screens` on web are measured there too.
- **iPhone playback is limited.** `ManagedMediaSource` arrives in iOS 17.1; older iPhones and every browser without MSE cannot play at all, and Safari's native HLS cannot send the header, so it is not a fallback.
- **Flipping `/web/` changes more than Jellyscale.** Jellyfin Desktop and Jellyfin for webOS load the server's `/web/` (`compat/clients.yaml:209-210`); they would run Octave web inside their shells. That may be welcome, but it is a product decision, not a side effect.
- **The token boundary gets weaker by construction.** Decision 0005's guarantee ("the token never enters JavaScript") cannot hold in a browser. The plan replaces it with a weaker, stated guarantee rather than letting the old claim quietly become false.
- **OIDC does not exist yet.** T17-04 depends on a Jellyscale design that has not been written; if Jellyscale chooses a cookie-based OIDC session, invariant 63 must change first, and that is its owner's decision.
- **Two clients in one repository.** `apps/tv` becomes the app for two forms. If the name or the platform split becomes confusing after milestone 4, rename the package then, as its own change, not during the plan.

## Progress

- [ ] 0
- [ ] 1
- [ ] 2
- [ ] 3
- [ ] 4
- [ ] 5
- [ ] 6
- [ ] 7

## Decision log

- 2026-11-26: Built from React Native Web over the existing app tree, with milestone 0 as a gate and a React DOM UI as the documented fallback. Reason: `react-native-web` is maintained (0.21.4, 2026-10-08; repo pushed 2026-11-26) and Expo SDK 58 pins it at the app's own React version, so one UI and one test suite stay possible; the risk is the tvOS fork under Metro's web alias, which is measurable in days.
- 2026-11-26: Served at `/octave/` first and moved to `/web/` by configuration once Jellyscale's e2e is green on Octave. Reason: Jellyfin Desktop and webOS load `/web/`, and the e2e tier is the proof of the cutover.
- 2026-11-26: A new phase (T17) rather than folding into T16. Reason: the browser brings its own engine and identity work; with Octave web existing, the desktop becomes a shell around it, which changes what T16-01 has to evaluate.
- 2026-11-26: No HLS library; the engine parses playlists itself against the shared vectors. Reason: a library would be a second URL builder and a second retry policy outside Playback Negotiation.

## Surprises & discoveries

## Validation evidence

## Outcome & retrospective
