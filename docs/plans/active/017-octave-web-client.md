# 017: Octave as Jellyscale's web client

## Goal / Done when

A viewer opens Jellyscale in a browser and watches: the server's own web client, talking only to the origin that served it, with the same honesty as the TV app. The browser cannot decode the file, so the server copies it and the player says so; when the browser can take it, it plays as it is.

- [ ] A viewer opens the origin Jellyscale served the client from, signs in with OIDC against Jellyscale or a password against plain Jellyfin, and reaches Home.
- [ ] Every request carries `Authorization` and no request carries a token in its URL: the wire test records zero `ApiKey`/`api_key` requests, zero `Cookie` or `Set-Cookie`, zero followed redirects other than the identity provider's, and **zero requests initiated by a media element**.
- [ ] A source whose container the browser cannot take is **copied**, not re-encoded, and the player says "Repackaging on server, original quality: {reason}". A source whose audio alone is unplayable keeps its video copied.
- [ ] A file the browser genuinely plays as it is (fragmented MP4 or WebM whose codecs it decodes) plays directly, and the info sheet says "Original file". Direct play is expected to be rare on the web and the UI never implies otherwise.
- [ ] Jellyscale's e2e tier drives Octave web and is green; the client is served at a configurable base path, with jellyfin-web still servable for rollback.
- [ ] A decision record replaces decision 0005's native-only token rule for the browser form, and `docs/security.md` states the web boundary with the test that proves it.
- [ ] `pnpm check` is green, and the Jellyscale checks this plan names are green.

## Context and domains touched

- **Server Connection & Identity** (DOMAINS §1): a browser session, OIDC, the token boundary. Decision 0005 is Android-shaped and `docs/security.md` §1 opens "This is Octave's security design for the TV app".
- **Playback Negotiation** (DOMAINS §3): **it changes for every form**, because the device capability model cannot express containers today.
- **Player Engine** (DOMAINS §6): a third engine behind the `PlayerEngine` port. Invariant **I7** forbids a player path that cannot send the header, naming a web video element (`ARCHITECTURE.md:258`).
- **Playback Session** (DOMAINS §4) and **Playstate Reporting** (DOMAINS §5): reused unchanged.
- **App Shell & Presentation** (DOMAINS §8): the same screens and tokens, with a responsive layout, pointer and keyboard.
- **Distribution** (DOMAINS §9): one bundle, hashed assets, a version handshake, a base path.

Jellyscale side:

- `GET /` redirects to `/web/`, served from `WebDir` by a bare `http.FileServer` (`internal/api/server.go:184-187`), open to anyone (`docs/access.md`, "Served outside the table").
- Every media route needs a token (D-026, `docs/status.md:141`).
- Invariant 63 forbids a cookie **including one for the OIDC sign-in** and forbids `Access-Control-Allow-Credentials` (`DOMAINS.md:185`).
- Pictures by id are the one content open to whoever holds the id (`docs/access.md`, "The model").
- Video-and-audio **copy** into fMP4 HLS is built and cheap (`docs/status.md:7`).
- OIDC is not built and is written as "a login link on jellyfin-web's login page" (JS-039); that framing must change.

## Decisions the web form takes differently

The table is the point of this plan: what must stay global, what may diverge, and what must diverge.

| Decision | TV / Android | Mobile | Web | Rule |
|---|---|---|---|---|
| Conversion honesty, copy wording, reason shown | same | same | same, and web converts more often | **Global** |
| No token in a URL, prop, event, log | same | same | same | **Global** |
| One authenticated client, no redirect, no cookie, one origin | same | same | same, and the origin is the one that served the page | **Global**, narrowed per form |
| No analytics, no third-party scripts | same | same | same, now enforced by CSP | **Global** |
| Negotiation, coordinator, reporter | core | core | core | **Global** |
| HLS URL and playlist rules | Kotlin validator | native | TypeScript validator against `packages/core/tests/fixtures/hls-playlists.json` | **Global rule**, per-form validator |
| Reduced motion | system setting | system setting | `prefers-reduced-motion` | **Global rule** |
| Service worker, offline | none | none | none | **Global** |
| Token location | Kotlin, never JS | native secure store | page memory plus one origin-scoped record | **Must diverge** (decision 0006) |
| Session across reload and tabs | persisted token | persisted token | shared origin record, `BroadcastChannel` sign-out | **Must diverge** |
| Player engine | Media3, libmpv | native | MSE over authenticated `fetch` | **Must diverge** |
| Device capabilities | engine probe | engine probe | `MediaSource.isTypeSupported` probe | **May diverge** (data, not rules) |
| Subtitle delivery | External/Embed per profile | same | WebVTT fetched with the header; PGS and styled ASS burnt in | **May diverge** (profiles are data) |
| Images | native view with the header | native view | `<img>` by item id (pictures are open), header fetch for trickplay | **May diverge**; I7's wording amended |
| Focus model | D-pad spatial, always visible | touch | `:focus-visible`, roving arrows inside rows | **Must diverge** |
| Pointer and hover | none | touch | hover brightens the fill; the ring stays keyboard-only | **May diverge**; principle 6 stands: nothing needs a pointer |
| Layout | 1920×1080 canvas, 5% inset | responsive | responsive, no canvas, no overscan | **Must diverge** |
| Type scale | 24 px floor at 3 m | own ramp | own ramp, 14–48 px | **Must diverge** |
| Back, rail | Back opens the rail | system back | history and real URLs, hash first | **Must diverge** |
| Volume, fullscreen | the TV owns both | system | the player chrome owns both | **Must diverge** |
| Preferences | native record | native record | `localStorage`, the same encoder | **May diverge** on store, **global** on format |
| Server choice, discovery, multiple servers | rail and accounts | same | none: one origin, the server that served the page | **Must diverge** |

## Forced constraints

1. **No `<video src>`, and no media element may initiate a request.** I7 and Jellyscale's token rule agree. The engine fetches init and media segments itself, with the header, and appends them to MSE. The wire test proves no request comes from an element.
2. **MSE takes fragmented MP4 and WebM.** An ordinary progressive MP4 cannot be appended (MSE's ISO-BMFF byte stream format expects an initialization segment and movie fragments). Whether a browser is lenient about a whole non-fragmented file is **unverified** and is milestone 0's second experiment. Until it is answered, assume the honest web path is the server's fMP4 HLS, with a copy.
3. **The token lives in page memory, and one origin-scoped record.** A browser cannot keep it out of JavaScript. XSS becomes the boundary, so: strict CSP with `connect-src 'self'`, no third-party scripts, no analytics, `credentials: "omit"`, and a single record in IndexedDB shared by tabs. Memory-only is not enough: Jellyscale deletes a device's previous token on sign-in (`internal/api/users.go:154`), so two tabs sharing an install id evict each other, and a reload signs the viewer out.
4. **The web form talks only to the origin that served it.** Jellyscale serves the client itself, so there is no server picker, no discovery, no CORS and no mixed content, and `connect-src 'self'` can be enforced. Plain Jellyfin is tested by serving the same build from that server's web directory. The native apps keep the multi-server story.
5. **A source the browser cannot take is copied, not re-encoded.** Today rule 5 turns video copy off whenever either stream is unplayable (`gateway.ts:935-937`), so an H.264 film whose audio is DTS would be **re-encoded** — a silent quality drop exactly where the product promises none. The capability model has no container dimension (`device-capabilities.ts:15-32`), and the profile accepts every container (`device-profile.ts:79-84`), so the server reports direct play for an MKV and the browser gets a file it cannot decode. Both are fixed in milestone 1.
6. **The transport port carries parsed JSON only** (`ports/transport.ts:35-38`), so media cannot go through it. Ranges and bytes need their own boundary, inside the token holder, and the adapter's public `authorizationHeader()` (`adapters/fetch-transport.ts:159`) is removed rather than reused.

## Dependencies

| Dependency | Check (primary source, 2026-11-26) | Verdict |
|---|---|---|
| `react-native-web` | npm `0.21.4` published 2026-10-08, canary `0.22.0-canary-20261120`; repo not archived, pushed 2026-11-26; peers `react ^19`, `react-dom ^19`, `react-native *`; Expo SDK 58 pins `~0.21.4` | Adopt `~0.21.4`, gated by milestone 0 |
| `react-dom` | Expo SDK 58 pins `19.3.0`, the app's React | Adopt `19.3.0` |
| HLS client | `hls.js` would add a second network path, its own retry and error model, and its own buffer policy beside the one the MVPD rules need | **Not adopted.** Own fMP4-VOD engine. Revisit only if milestone 0 shows buffer management is the bottleneck; record the check if so |
| Media Source Extensions | W3C API; `ManagedMediaSource` is required on iPhone 17.1+ | No dependency; probed at run time |

The shared playlist fixtures already exist (`packages/core/tests/fixtures/hls-playlists.json`), so the TypeScript validator starts from the vectors Kotlin is held to.

## Milestones

0. **Three falsifiers, before any task is written.** (a) Export `apps/tv` with `expo export --platform web` and open it at 1920×1080, 1280×800 and 390×844, driving it with a mouse and a keyboard; record first content, a 60 s idle memory figure, and whether rows, cards and dialogs focus and scroll acceptably. (b) Run browser-like capabilities through the existing negotiation over the tripwire fixtures and count direct plays, copies and re-encodes for a mixed library. (c) In Chromium and Safari, append a progressive MP4 and a 60–80 Mbps fMP4 copy to `MediaSource`, and record what happens. Validation: the three results are pasted into this plan. Model: opus. **Gates:** if (a) fails, the UI is a React DOM app on `packages/core`; if (b) shows re-encodes where a copy would do, milestone 1 is not optional; if (c) shows progressive MP4 cannot be appended, direct play on the web is fMP4/WebM only and the Done-when stays as written.
1. **Negotiation learns containers (all forms).** Add containers to `PlayerCapabilities` and `SourceFormat`; judge them in `devicePlayability`; add a remux request (`EnableDirectPlay: false`, `AllowVideoStreamCopy: true`) and turn video copy off only for the stream that cannot play. Jellyscale must honour both flags — it ignores them today (no occurrence in `internal/**/*.go`) — and the issue is filed against it, labelled `from:fluster`, with the evidence. Validation: core tests for the new decision kind; the tripwire count from milestone 0 (b) improves; a Jellyscale wire test asks for copy and gets fMP4 HLS. Model: opus.
2. **Decision 0006 and the product text.** `docs/decisions/0006-web-token-boundary.md`: the token in page memory and one IndexedDB record, `BroadcastChannel` sign-out, the "shared computer" memory-only choice, XSS as the boundary, CSP, what is never persisted, and the test for each. `PRODUCT.md` gains the web form and its single-origin rule; `DESIGN.md` gains the web form's pointer, layout and type rules with the TV still the reference; `docs/security.md` gains the web section; I7's image wording is amended for pictures by id. Validation: `gate: review`. Model: fable for the decision, opus for the text.
3. **The web host and the token's owner (`packages/web-host`).** A host that owns the token in a `#private` map and exposes the existing `Transport` plus a `mediaFetch(session, path, range, signal)` returning bytes — `credentials: "omit"`, `redirect: "manual"`, `referrerPolicy: "no-referrer"`, same origin only. Storage: the session record, the install id, the device preference record. WebCrypto, with a JS SHA-256 fallback for a plain-HTTP origin that is not a secure context. Password sign-in. The adapter's `authorizationHeader()` is removed. Validation: Node tests for the host and the storage allowlist; a Chromium run that signs in and renders Home against the fixtures image. Model: opus.
4. **The MSE engine.** The `PlayerEngine` port over MSE, fMP4 HLS only in v1: the plan from negotiation, a playlist parser passing the shared vectors, a range-capable segment fetcher through `mediaFetch`, append per stream with a byte budget and back-buffer trimming, `QuotaExceededError` handled as normal, seek, buffering, recovery. Capabilities probed with `MediaSource.isTypeSupported`, `passthrough: []`. Subtitles: WebVTT fetched with the header and drawn in Octave's overlay; PGS and styled ASS requested as burn-in. Validation: the shared vectors in TypeScript; a Chromium e2e plays a copied MKV, a transcode and a fragmented MP4, seeks, switches audio and subtitles. Model: opus.
5. **Browse and input.** The screens from the TV tree behind React Native Web (or the DOM app if milestone 0 failed), with a responsive layout, the web type ramp, roving focus inside rows, `:focus-visible`, hover that brightens a fill, history and Back, and hash routes under the base path. Validation: captures at 1920×1080, 1280×800 and 390×844; a keyboard-only pass; `DESIGN.md` review. Model: sonnet with an opus review.
6. **OIDC.** With Jellyscale, three `anyone` routes with state in Postgres and no cookie: `GET /jellyscale/v1/oidc/start?challenge=&state=` answering a 302 to the provider; a callback answering a 302 to the client with a **one-use code** (60 s, bound to the challenge); `POST /jellyscale/v1/oidc/token {code, verifier}` answering the `AuthenticateByName` body. The client gains a third `SignInCredential` kind, never sees a provider token, and re-authenticates with a top-level `prompt=none` redirect after a confirmed 401. Jellyscale adds the CSP header and the `index.html` fallback, because `/web/` is a bare `http.FileServer`. Validation: the wire test with a test identity provider — no `Set-Cookie`, no token in a URL, the provider navigation the only redirect, sign-out revoking and propagating to other tabs. Model: opus, fable reviewing the boundary.
7. **Packaging and cutover.** One bundle, hashed and immutable, with `index.html` and `version.json` served `no-cache`; relative asset URLs and hash routes so one build serves any base path; the page polls `version.json` and reloads on a route change, never mid-viewing. Jellyscale serves it at `/octave/` first, its e2e tier drives it, and then `/web/` moves by configuration. Validation: Jellyscale's `test/e2e` green against Octave; both paths served; rollback is one value. Model: opus.
8. **Hardening.** Buffer quota and memory on low-memory tabs and phones, Safari and iPadOS, iPhone's `ManagedMediaSource` limit stated plainly, CSP reviewed, accessibility, and the performance budgets measured. Validation: budgets recorded with their runs; a security review. Model: opus.

Each milestone's work gets its own spec in `docs/specs/<TASK-ID>.md` before implementation. The T17 tasks do not exist in `tasks/prd.json` yet: a Product Owner pass adds them, and this plan does not.

## What Jellyscale must change

- **JS-150** pins Octave instead of jellyfin-web.
- **JS-039** is re-framed around the three OIDC routes above.
- **PlaybackInfo must honour `EnableDirectPlay: false` and `AllowVideoStreamCopy: true`.** It ignores them today (no occurrence in `internal/**/*.go`), which is also a Jellyfin-compatibility gap; Jellyfin honours both.
- **`/web/` needs a CSP header, `no-cache` on `index.html` and `version.json`, and an `index.html` fallback** for a deep link reload, because it is served by a bare `http.FileServer` (`server.go:185`).
- **JS-122** is likely unnecessary once Octave web has a Settings screen; decide at milestone 5.
- **The e2e tier** (10 browser suites) moves from jellyfin-web to Octave. This is the real cost of "default", and it is also the proof.
- `compat/endpoints.yaml`'s `alias` rows exist only for jellyfin-web and can be revisited as a group after the cutover.

## Risks

- **Direct play on the web may be nearly nonexistent.** If progressive MP4 cannot be appended, almost every film is a server copy. That is honest and cheap, but it changes the product sentence on web from "plays the original" to "copies the original", and the UI copy must say so rather than let the TV's claim leak.
- **The token boundary is weaker by construction.** Decision 0005's guarantee cannot hold in a browser; the plan replaces it with a stated, tested weaker one.
- **Buffer quota.** A copy carries the file's whole bitrate (`docs/status.md:7`), so a single 4K segment may exceed a `SourceBuffer` quota. Quota sizes per browser are unverified; milestone 0 (c) measures it, milestone 8 hardens it.
- **React Native Web at phone width.** The TV tree's focus layer is native (`TVFocusGuideView`, `requestTVFocus`, `useTVEventHandler` in 8 files); shimming it to DOM may be stiff. Milestone 0 (a) is the test, and the DOM fallback is real work, not a footnote.
- **`react-native-tvos` under Metro's web alias is unverified**, as are `flash-list`, `reanimated` and `screens` on web.
- **OIDC does not exist yet.** If Jellyscale chooses a cookie-based OIDC session, invariant 63 must change first, and that is its owner's decision.
- **Flipping `/web/` changes Jellyfin Desktop and Jellyfin for webOS**, which load the server's `/web/`; they would run Octave web inside their shells. That is a product decision, not a side effect.

## Progress

- [ ] 0
- [ ] 1
- [ ] 2
- [ ] 3
- [ ] 4
- [ ] 5
- [ ] 6
- [ ] 7
- [ ] 8

## Decision log

- 2026-11-26: One UI tree via React Native Web, gated by a falsifier at three widths and with a pointer, with a React DOM UI on `packages/core` as the documented fallback. Reason: `react-native-web` is maintained and Expo 58 pins it; the risk is the tvOS focus layer, not the library.
- 2026-11-26: Served at `/octave/` first, moved to `/web/` by configuration once Jellyscale's e2e is green. Reason: Jellyfin Desktop and webOS load `/web/`, and the e2e tier is the proof.
- 2026-11-26: A new phase (T17) rather than folding into T16. Reason: the browser brings its own engine and identity work; with Octave web existing, the desktop becomes a shell around it.
- 2026-11-26: No HLS library; an own fMP4-VOD engine against the shared vectors. Reason: a library would be a second network path and a second retry policy beside the ones the rules define. Revisit if buffer management proves to be the bottleneck.
- 2026-11-26: The web form talks only to the origin that served it. Reason: it removes discovery, server choice, CORS and mixed content, and makes `connect-src 'self'` enforceable — the single strongest XSS control available to a browser client.
- 2026-11-26: One origin-scoped session record rather than memory only. Reason: Jellyscale deletes a device's previous token on sign-in (`internal/api/users.go:154`), so two tabs sharing an install id would evict each other, and a reload would sign the viewer out; a "shared computer" choice keeps the memory-only behaviour for whoever wants it.
- 2026-11-26: Images by item id through `<img>`, with trickplay still header-fetched. Reason: both servers serve pictures by id without a token by design, and a header fetch would bypass the browser's cache and cost memory on the least capable devices. I7's wording is amended, not abandoned.

## Surprises & discoveries

- Two independent reviews (Fable 5.2, Gemini 4 Neon) reached the same three technical findings from the code: the capability model has no containers, rule 5 disables video copy for both streams, and the `Transport` port carries parsed JSON only. All three verified by reading the code; none was in the first draft of this plan.
- Jellyscale ignores `EnableDirectPlay` and `AllowVideoStreamCopy` entirely: `grep` returns nothing across `internal/**/*.go`, and its own decision reads `DirectPlayProfiles` instead (`internal/playback/decide.go:794-845`), where an empty list means "any" (`decide.go:933-936`).
- `packages/core/tests/fixtures/hls-playlists.json` exists, so the TypeScript validator inherits the vectors rather than needing new ones.

## Validation evidence

## Outcome & retrospective
