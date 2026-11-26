# 017: Octave as Jellyscale's web client

## Goal / Done when

A viewer opens Jellyscale in a browser and watches, from the server's own web client, which talks only to the origin that served it. The picture is as good as their browser can take and the app says what it did: an fMP4 stream the server copied reads "Repackaging on server, original quality"; a re-encode reads "Converting on server" with its reason; audio that a browser cannot pass through is named.

Evidence for every claim below: `docs/research/web-client.md`.

- [ ] A viewer signs in at the origin Jellyscale served the client from — OIDC against Jellyscale, a password against plain Jellyfin — and reaches Home.
- [ ] Every request carries `Authorization`, and no request carries a token in its URL: the wire test records zero `ApiKey`/`api_key` requests, zero `Cookie`/`Set-Cookie`, the identity provider's navigation as the only redirect, and zero requests initiated by a media element.
- [ ] A source the browser cannot take is copied into fMP4 HLS, not re-encoded, and the player says so; a source with unplayable audio keeps its video copied and names the audio.
- [ ] A 4K remux does not stall: the engine reports a bitrate ceiling, negotiation acts on it, and `QuotaExceededError` never reaches the viewer.
- [ ] Subtitles render on the client — WebVTT, ASS and PGS — with fonts from the film's own attachments and no third-party fetch; burn-in is a visible fallback.
- [ ] Jellyscale's e2e tier drives Octave web and is green; the client is served at a configurable base path with jellyfin-web still servable.
- [ ] A decision record replaces decision 0005's native-only token rule for the browser form, and `docs/security.md` states the web boundary with the test that proves it.
- [ ] `pnpm check` is green, and the Jellyscale checks this plan names are green.

## Scope of the web form

**In:** Chrome, Edge and Firefox on desktop; Safari on macOS; Safari on iPhone and iPad through `ManagedMediaSource` (`disableRemotePlayback = true`, AirPlay given up).

**Out of v1, explicitly:** TV browsers (webOS, Tizen, Silk) and the Jellyfin shells. Tizen caps MSE at FHD and needs AVPlay for UHD, which a web page cannot reach; Jellyfin Desktop is a jellyfin-web host with its own mpv contract, and Jellyfin for Tizen bundles its own copy. Pointing `/web/` at Octave breaks Desktop and webOS, so the cutover keeps jellyfin-web reachable until that is decided.

## Decisions the web form takes differently

| Decision | TV / Android | Mobile | Web | Rule |
|---|---|---|---|---|
| Conversion honesty, copy wording, reasons | same | same | same, and web converts much more often | **Global** |
| No token in a URL, prop, event, log | same | same | same | **Global** |
| One authenticated client, no redirect, no cookie, one origin | same | same | same, and the origin is the one that served the page | **Global**, narrowed per form |
| No analytics, no third-party scripts | same | same | same, enforced by CSP | **Global** |
| Negotiation, coordinator, reporter | core | core | core | **Global** |
| HLS URL and playlist rules | Kotlin validator | native | TypeScript validator, then hls.js is fed only validated playlists | **Global rule**, per-form validator |
| Reduced motion | system | system | `prefers-reduced-motion` | **Global rule** |
| Service worker, offline | none | none | **none**: no authenticated caching, no offline | **Global** |
| Token location | Kotlin, never JS | native secure store | page memory, or `localStorage` on a trusted computer | **Must diverge** (decision 0006) |
| Session renewal | persisted token | persisted token | no refresh token, no hidden iframe: expiry means a page-level sign-in | **Must diverge** |
| Player engine | Media3, libmpv | native | MSE through hls.js with a header-injecting loader | **Must diverge** |
| Direct play | the original file | the original file | **fragmented MP4 or WebM only**; a progressive MP4 cannot be appended at all | **Must diverge** |
| Buffer | seconds to minutes | seconds to minutes | bytes: ~150 MiB desktop, ~100 MiB iOS, so a bitrate ceiling is a capability | **Must diverge** |
| Audio | passthrough or decode | passthrough or decode | no passthrough API; DTS and TrueHD cannot play | **Must diverge** |
| HDR | HDR10 and Dolby Vision | both | browser-reported decode and display; Dolby Vision only in Safari, base layer elsewhere | **Must diverge**, and the wording never claims confirmation |
| Subtitles | external or burnt in | same | WebVTT overlay, ASS via JASSUB, PGS via libbitsub, fonts from attachments | **May diverge** |
| Images | native view with the header | native view | `<img>` by item id (pictures are open) under `img-src 'self'`; trickplay fetched with the header | **May diverge**; I7's image wording amended |
| Focus model | D-pad spatial, always visible | touch | `:focus-visible` plus roving arrows inside rows | **Must diverge** |
| Pointer and hover | none | touch | hover brightens the fill; the ring stays keyboard-only | **May diverge**; nothing needs a pointer |
| Layout | 1920×1080 canvas, 5% inset | responsive | responsive, no canvas, no overscan | **Must diverge** |
| Type scale | 24 px floor at 3 m | own ramp | own ramp, 14–48 px | **Must diverge** |
| Back, rail | Back opens the rail | system back | history and real URLs | **Must diverge** |
| Volume, fullscreen | the TV owns both | system | the chrome owns both | **Must diverge** |
| Preferences | native record | native record | `localStorage`, the same encoder | **May diverge** on store, **global** on format |
| Server choice, discovery, many servers | rail and accounts | same | none: one origin | **Must diverge** |
| TV browsers and Jellyfin shells | n/a | n/a | **not supported in v1** | **Must diverge** |

## Forced constraints

1. **No `<video src>`, and no media element may initiate a request.** I7 and Jellyscale's token rule agree. The engine fetches everything with the header and feeds MSE.
2. **Progressive MP4 cannot be appended.** Chrome raises `CHUNK_DEMUXER_ERROR_APPEND_FAILED`; Firefox silently buffers nothing. So web direct play is fragmented MP4 and WebM, and everything else is fMP4 HLS. A watchdog is mandatory: `updateend` with a `buffered` range that did not grow is a failure.
3. **Buffers are tens of seconds, not minutes.** Chromium ~150 MiB, Firefox ~150 MiB, Safari macOS ~289 MiB, iOS ~100 MiB — about 10 s at 80 Mbps. The engine reports a bitrate ceiling, and negotiation uses it; the engine budgets in bytes, appends small fragments, trims behind, and treats `QuotaExceededError` as normal.
4. **No audio passthrough exists.** DTS, DTS-HD and TrueHD cannot be fed to MSE in the tested engines. The honest sentence is that the audio is converted; a lossless track is never promised.
5. **The token lives in page memory, or `localStorage` on a trusted computer.** Jellyscale deletes a device's previous token at sign-in (`internal/api/users.go:154`), so tabs must share one record; a reload must not sign the viewer out. Memory-only remains the "shared computer" choice. CSP is the control, and it must come from the server.
6. **The transport port carries parsed JSON only** (`ports/transport.ts:35-38`), so media needs its own boundary inside the token holder, with ranges and bytes. The adapter's public `authorizationHeader()` (`adapters/fetch-transport.ts:159`) is removed rather than reused.
7. **The web form talks only to the origin that served it.** That removes server choice, discovery, CORS and mixed content, and makes `connect-src 'self'` enforceable — the strongest XSS control available to a browser client.

## Dependencies

| Dependency | Check (primary source, 2026-11-26) | Verdict |
|---|---|---|
| `react-native-web` | `0.21.4` published 2026-10-08, canary 2026-11-20; repo pushed 2026-11-26; peers `react ^19`, `react-dom ^19`; Expo 58 pins `~0.21.4` | Adopt `~0.21.4`, gated by milestone 0 |
| `react-dom` | Expo SDK 58 pins `19.3.0` | Adopt `19.3.0` |
| `hls.js` | `1.7.4` published 2026-10-28, Apache-2.0, video-dev/hls.js; `xhrSetup`/custom loader can add the header; 1.7.0 added `BUFFER_APPEND_NO_PROGRESS` | **Adopt**, wrapped behind the `PlayerEngine` port; it is fed only playlists that passed the shared vectors |
| `jassub` | `2.5.38` published 2026-11-16, LGPL-2.1-or-later (compatible with the app's GPL-3.0), takes pre-fetched bytes and font buffers | Adopt; `queryFonts` must never be `'localandremote'` |
| `libbitsub` | `1.13.2` published 2026-11-01, MIT, takes pre-fetched bytes | Adopt for PGS, VobSub and DVB |
| Media Source Extensions | W3C API; `ManagedMediaSource` required on iPhone 17.1+ | No dependency; probed at run time |

The playlist vectors already exist (`packages/core/tests/fixtures/hls-playlists.json`), so the TypeScript validator starts from the same suite Kotlin is held to.

## Milestones

0. **Falsifiers, before any task is written.** (a) Export `apps/tv` with `expo export --platform web` and open it at 1920×1080, 1280×800 and 390×844 with a mouse and a keyboard; record first content, 60 s idle memory, focus latency and scroll frames against `docs/research/web-client.md` §4's thresholds, and count the files that need web variants (target ≤12 of 45). (b) Append an fMP4 HLS stream from Jellyscale to MSE through hls.js with a header-injecting loader, at 4K remux bitrate, in Chromium and Safari, and record the quota behaviour. (c) Measure whether a service worker can serve a same-origin `<video src>` with the header (Firefox bug 1923096), as a one-day experiment with a security note. Validation: the three results are pasted here. Model: opus. **Gates:** if (a) fails, the UI is a React DOM app on `packages/core`; if (c) succeeds, the engine design is reconsidered rather than assumed.
1. **Negotiation learns the two dimensions it lacks.** A per-device **bitrate ceiling** in the capability report, acted on by the source decision; containers judged for the container-only remux case; and rule 5 turning off copy only for the stream that cannot play. Jellyscale must honour and echo the copy flags — it reads none today — and must not silently downmix to stereo through a missing `MaxAudioChannels`. Validation: core tests; the tripwire count of copies against re-encodes improves; a Jellyscale wire test asks for copy and gets fMP4 HLS. Model: opus.
2. **Decision 0006 and the product text.** The token in page memory or one `localStorage` record; `BroadcastChannel` sign-out; the shared-computer mode; XSS as the boundary; the CSP; no service worker; what is never persisted; the test for each. `PRODUCT.md` gains the web form, its single-origin rule and its media limits; `DESIGN.md` gains the web form's pointer, layout and type rules; `docs/security.md` gains the web section; I7's image wording is amended for pictures by id. Validation: `gate: review`. Model: fable for the decision, opus for the text.
3. **The web host and the token's owner (`packages/web-host`).** A host owning the token in a `#private` map, exposing the existing `Transport` plus `mediaFetch(session, path, range, signal)` with `credentials: "omit"`, `redirect: "manual"`, `referrerPolicy: "no-referrer"`, same origin only. Session record, install id, device preferences, WebCrypto. Password sign-in. `authorizationHeader()` removed. Validation: Node tests for the host and the storage allowlist; a Chromium run that signs in and renders Home against the fixtures image. Model: opus.
4. **The engine.** The `PlayerEngine` port over hls.js: the plan from negotiation; a validated playlist through the shared vectors with every `ApiKey` stripped on rebuild; a custom loader that adds the header and refuses a foreign origin; a byte budget with early `remove()`, small fragments, and a `QuotaExceededError` path; a watchdog for silent non-progress; seek, buffering, recovery; `ManagedMediaSource` on iPhone with `disableRemotePlayback`. Capabilities probed per exact codec string, with `passthrough: []` and the bitrate ceiling. Validation: shared vectors in TypeScript; a Chromium e2e plays a copied MKV, a transcode and a fragmented MP4, seeks and switches audio; an iPhone check of the MMS path. Model: opus.
5. **Subtitles on the client.** WebVTT drawn in Octave's overlay; ASS through JASSUB with the film's attachment fonts; PGS, VobSub and DVB through libbitsub; burn-in requested only when a renderer is unavailable or too slow, and then shown as a conversion. Validation: a film with an ASS track and one with PGS play with the right fonts and no network request outside the origin; the burn-in fallback is exercised once. Model: sonnet with an opus review.
6. **Browse and input.** The screens through React Native Web (or a DOM app if milestone 0 failed): responsive layout, the web type ramp, roving focus in rows, `:focus-visible` with a ring that also works without it, hover, history and Back, real URLs. Validation: captures at three sizes; a keyboard-only pass; `DESIGN.md` review. Model: sonnet with an opus review.
7. **OIDC.** Jellyscale as the confidential client: `POST /jellyscale/v1/oidc/start {handoffChallenge}` answers the sign-in URL; the callback answers `303 /web/#sso=<one-time code, 60 s>`; `POST /jellyscale/v1/oidc/token {handoffCode, handoffVerifier}` answers the usual authentication result. The verifier lives in `sessionStorage`; the page never sees an IdP token; expiry is a page-level sign-in; sign-out revokes and reaches other tabs. HTTPS only. Validation: the wire test with a test identity provider — no `Set-Cookie`, no token in a URL, the provider navigation the only redirect, sign-out revoking and propagating. Model: opus, fable reviewing the boundary.
8. **Serving, packaging and cutover.** A static handler in Jellyscale: history-API fallback from memory with `no-cache` and an ETag, hashed assets `immutable`, precompressed `.br`/`.gz`, `version.json` `no-store`, the CSP and security headers, and the three seams (`normalize`'s lowercase exclusion, `crossOrigin`, `logRequests`). One build with relative asset URLs serves any prefix. `/octave/` first, its e2e driving Octave, then `/web/` by configuration with jellyfin-web still servable for Desktop and webOS. Validation: Jellyscale's `test/e2e` green against Octave; both paths served; rollback is one value. Model: opus.
9. **Hardening.** iPhone and iPad figures, low-memory sessions, Safari's buffer eviction, the service-worker finding if milestone 0 (c) pursued it, accessibility, and performance budgets measured. Validation: budgets recorded with their runs; a security review. Model: opus.

Each milestone's work gets its own spec in `docs/specs/<TASK-ID>.md` before implementation. The T17 tasks do not exist in `tasks/prd.json` yet: a Product Owner pass adds them, and this plan does not.

## What Jellyscale must change

- **Honour and echo the five PlaybackInfo flags.** It reads none of them today while Jellyfin 12.4 defines them and jellyfin-web sends `EnableDirectPlay`. Parity, not a new feature.
- **Stop downmixing silently.** Octave's profile carries no `MaxAudioChannels`; more than two channels becomes AAC stereo, often with no reason in the answer.
- **A browser-shaped source for `MaxAudioChannels` and bitrate** is Octave's side; the server only has to report what it did.
- **Serve the SPA properly**: history fallback, cache headers, CSP, precompressed assets, and the three seams.
- **OIDC routes** as milestone 7 describes, plus back-channel logout.
- **Delivery variants** on `/jellyscale/v1/items/{id}/playback-info` would let a client state the delivery it wants instead of describing itself — but it is a feature built for one client, which Jellyscale's D-027 forbids. It waits for the owner.
- **The e2e tier** moves from jellyfin-web to Octave; that is the proof of the cutover.

## Risks

- **"Original file" is rare on the web.** Most films are a server copy. The UI must say "Repackaging on server, original quality", never let the TV's claim leak.
- **Buffer starvation on 4K.** A 4K remux is ~10 s of buffer on iOS; without a bitrate ceiling the viewer sees stalls that look like a network fault.
- **The cutover breaks the shells.** Jellyfin Desktop and Jellyfin for webOS load `/web/`; Desktop's mpv plugin and webOS's `manifest.json`/`NativeShell` contract are jellyfin-web's. Keep jellyfin-web reachable until that is decided.
- **A browser cannot keep the token out of JavaScript.** Decision 0005's guarantee is replaced by a stated, tested weaker one, not quietly dropped.
- **React Native Web at phone width.** The focus layer is native in 8 files; shimming it may be stiff, and the DOM fallback is real work.
- **hls.js is a large dependency** with its own retry and error semantics; it must be wrapped so the rules, not the library, decide what plays.
- **OIDC does not exist yet**, and RFC 10017 discourages browser tokens for personal-data apps; the design is a BFF handoff, which is the strongest form available without cookies.

## Progress

- [ ] 0

## Decision log

- 2026-11-26: One UI tree through React Native Web, gated by a falsifier at three widths with a pointer, React DOM on `packages/core` as the fallback. Reason: RNW is maintained and Expo 58 pins it; the risk is the TV focus layer (`docs/research/web-client.md` §4).
- 2026-11-26: `/octave/` first, `/web/` by configuration once Jellyscale's e2e is green. Reason: Desktop and webOS load `/web/`, and the e2e is the proof.
- 2026-11-26: A new phase (T17); T16 derives from it. Reason: the browser brings its own engine and identity work, and the desktop becomes a shell around it.
- 2026-11-26: **hls.js behind the port**, reversing the earlier "own engine" decision. Reason: its loader can add the header (`xhrSetup`, unused by jellyfin-web), it carries the buffer and Safari/MSE edge cases that a hand-rolled engine would rediscover, and `BUFFER_APPEND_NO_PROGRESS` covers the silent Firefox failure. Playlists still pass the shared vectors before it sees them.
- 2026-11-26: The web form talks only to the origin that served it. Reason: it removes discovery, server choice, CORS and mixed content and makes `connect-src 'self'` enforceable.
- 2026-11-26: One shared session record rather than memory only, with a shared-computer mode. Reason: Jellyscale deletes a device's previous token at sign-in (`internal/api/users.go:154`), so tabs would evict each other and a reload would sign the viewer out.
- 2026-11-26: Client-side ASS and PGS rendering, with burn-in as a visible fallback. Reason: JASSUB and libbitsub are maintained and take pre-fetched bytes, and burn-in forces a video transcode.
- 2026-11-26: TV browsers and the Jellyfin shells are out of v1. Reason: Tizen caps MSE at FHD, Desktop is a jellyfin-web host with its own mpv contract, and webOS needs a manifest and shim; each is a separate product decision.
- 2026-11-26: Images by item id through `<img>`, trickplay with the header. Reason: both servers serve pictures by id without a token by design, and a header fetch would bypass the browser cache; I7's wording is amended, not abandoned.

## Surprises & discoveries

- Progressive MP4 is not merely unreliable in MSE: Chrome errors and Firefox fails silently (`docs/research/web-client.md` §1).
- Browser buffers are ten seconds at 4K remux bitrates, so a bitrate ceiling is a capability, not an optimisation.
- No web API can request or confirm audio passthrough, so lossless audio cannot reach an AVR from a browser.
- Jellyfin itself puts the token in subtitle and trickplay URLs, which is why every surveyed browser client does.
- `packages/core/tests/fixtures/hls-playlists.json` already exists, so the TypeScript validator inherits the vectors.
- Jellyscale reads none of the five PlaybackInfo flags, though Jellyfin 12.4 defines them all.

## Validation evidence

## Outcome & retrospective
