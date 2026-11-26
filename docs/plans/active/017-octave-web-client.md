# 017: Octave as Jellyscale's web client

## Goal / Done when

A viewer opens Jellyscale in a browser and watches, from the server's own web client, which talks only to the origin that served it. The picture is as good as their browser can take and the app says what it did: an fMP4 stream the server copied reads "Repackaging on server, original quality"; a re-encode reads "Converting on server" with its reason; audio that a browser cannot pass through is named.

Evidence for every claim below: `docs/research/web-client.md`.

**Status, 2026-11-26.** A Product Owner pass ruled on this plan (`tasks/product-owner-log.md`, "2026-11-26, plan 017 pass"); every ruling is provisional, for the owner's veto. Milestone 0 may run. Milestones 1 to 9 wait for two answers this plan cannot give itself: Jellyscale's owner on whether Jellyscale does work to serve and test Octave (its D-027 and `PRODUCT.md:83` say no work goes in for Octave), and the owner on decision 0006.

- [ ] A viewer signs in at the origin Jellyscale served the client from, by OIDC over HTTPS or by a password, and reaches Home. Plain Jellyfin serving Octave's web form is unverified and is not a v1 gate; the core still speaks to both servers.
- [ ] Every request carries `Authorization`, and no request carries a token in its URL: the wire test records zero `ApiKey`/`api_key` requests, zero `Cookie`/`Set-Cookie`, the identity provider's navigation as the only redirect, and zero requests initiated by a media element.
- [ ] A source the browser cannot take is copied into fMP4 HLS, not re-encoded, and the player says so; a source with unplayable audio keeps its video copied and names the audio.
- [ ] A 4K remux does not stall: the engine reports a bitrate ceiling, negotiation acts on it, and `QuotaExceededError` never reaches the viewer.
- [ ] Subtitles render on the client — WebVTT, ASS and PGS — with fonts from the film's own attachments and no third-party fetch; burn-in is a visible fallback.
- [ ] Octave's own wire and browser tests pass against the pinned Jellyscale, and one build is servable at any base path and never needs `/web/`. Whether Jellyscale's e2e tier drives Octave is Jellyscale's owner's call (D-027) and is not this plan's gate.
- [ ] A browser that cannot run the client sees a designed notice, never a blank page.
- [ ] A decision record replaces decision 0005's native-only token rule for the browser form, and `docs/security.md` states the web boundary with the test that proves it.
- [ ] `pnpm check` is green, and the wire tests against the pinned Jellyscale are green.

## Scope of the web form

**In:** Chrome, Edge and Firefox on desktop; Safari on macOS; Safari on iPhone and iPad through `ManagedMediaSource` (`disableRemotePlayback = true`, AirPlay given up).

**Out of v1, explicitly:** TV browsers (webOS, Tizen, Silk) and the Jellyfin shells. Tizen caps MSE at FHD and needs AVPlay for UHD, which a web page cannot reach; Jellyfin Desktop is a jellyfin-web host with its own mpv contract, and Jellyfin for Tizen bundles its own copy. Pointing `/web/` at Octave breaks Desktop and webOS, so the cutover keeps jellyfin-web reachable until that is decided.

**What "out" means for a viewer.** Out means untested and unpromised, not blocked. Octave reads no user-agent string to refuse anyone (`docs/research/web-client.md` §1: probe, never a user-agent table). Two cases:

- **The browser cannot run the client** (the bundle does not start, or no `MediaSource` and no `ManagedMediaSource`): a small script in old syntax, loaded before the bundle and allowed by the CSP, shows a static notice. Title: "This browser can't run Octave". Body: "Octave needs a current version of Chrome, Edge, Firefox or Safari. On a TV, use a Jellyfin app made for your TV." Whether it links to jellyfin-web depends on Jellyscale still serving it; the task's spec decides.
- **The browser runs it** (a recent webOS, for example): it runs, with what its probes report and no D-pad promise. No banner says "unsupported".

## Product wording on the web

The wording rules are global (`PRODUCT.md`, "Original first: what viewers see"; `packages/core/src/domain/conversion-copy.ts`). The web form adds these, and milestone 2 puts them in `DESIGN.md` §10. All are Product Owner calls of 2026-11-26, for the owner's veto.

| Case | What the viewer reads |
|---|---|
| Every stream copied into fMP4 (the normal case) | "Repackaging on server, original quality: {reason}", unchanged. Loading: the same sentence with "…", a new §10 row beside "Player loading, converting". |
| Video copied, audio re-encoded | "Converting audio on server, original picture: {reason}". New. **"Original quality" is said only when every stream is copied.** |
| Video re-encoded | "Converting on server: {reason}", unchanged. |
| The bitrate ceiling is the reason | "Converting on server: the bitrate is too high for this browser". A new client reason. It is not the viewer's streaming limit, so it never offers "Play original". |
| The browser cannot take the container or a codec | The existing reason copy ("the file format is not supported here"). In the two client sentences "this device" reads "this browser": "this browser can't play the original file". |
| A fragmented MP4 or WebM played as stored | "Original file", unchanged, and only then. "Opening the original file…" shows for no other plan. |
| Info sheet, audio output | "Decoded by the browser". Never "Passthrough". |
| Settings, Audio passthrough | "Not available in a browser." The row takes no focus. |
| Info sheet, video range | The range as on the TV, then "(reported by the browser)": "HDR (PQ) (reported by the browser)". When the screen reports no high dynamic range: "HDR video. This screen doesn't report HDR." Octave never says the picture on the glass is HDR. |
| Dolby Vision outside Safari | The range that plays, never "Dolby Vision": the base layer is HDR10 or SDR and is named as that. |
| Burned-in subtitles (the fallback) | "Converting on server: the subtitle format is not supported here", with "Subtitles are burned in", both unchanged. |

Unverified, for milestone 1's spec: that each server's answer lets the client tell "audio re-encoded, video copied" from a full copy. Until it does, the mixed case reads "Converting on server".

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
7. **The web form talks only to the origin that served it.** That removes server choice, discovery, CORS and mixed content, and makes `connect-src 'self'` enforceable — the strongest XSS control available to a browser client. The cost is stated in `PRODUCT.md`: the native apps keep many servers and the browser has one; a viewer with two servers opens two addresses. "Who's watching?" stays, for accounts on the one server.
8. **Plain HTTP has no `crypto.subtle`** (`docs/research/web-client.md` §3), and the DeviceId is a SHA-256 through the Crypto port (`packages/core/src/jellyfin/device-id.ts:9`). Password sign-in on a plain-HTTP home-network server therefore needs a Crypto adapter that does not use WebCrypto; milestone 3 owns it.
9. **`/web/` is also where the TV's QR code points.** The TV builds its Quick Connect approval link as `{server}/web/#/quickconnect?code={code}` (`packages/core/src/domain/quick-connect.ts:21` on `main`). Octave must answer that link with a working approval page before it can sit at `/web/`.

## Dependencies

| Dependency | Check (primary source, 2026-11-26) | Verdict |
|---|---|---|
| `react-native-web` | `0.21.4` published 2026-10-08, canary 2026-11-20; repo pushed 2026-11-26; peers `react ^19`, `react-dom ^19`; Expo 58 pins `~0.21.4` | **Not adopted yet.** Milestone 0 (a) may export with it. T16-01's acceptance says it "is not a candidate (its author says Meta has no investment in it and points new projects to React Strict DOM)"; adoption needs a maintenance check that answers that statement from primary sources, and the owner's word, since T16-01 is the owner's decision |
| `react-dom` | Expo SDK 58 pins `19.3.0` | Adopt `19.3.0` |
| `hls.js` | `1.7.4` published 2026-10-28, Apache-2.0, video-dev/hls.js; `xhrSetup`/custom loader can add the header; 1.7.0 added `BUFFER_APPEND_NO_PROGRESS` | **Adopt**, wrapped behind the `PlayerEngine` port; it is fed only playlists that passed the shared vectors |
| `jassub` | `2.5.38` published 2026-11-16, LGPL-2.1-or-later (compatible with the app's GPL-3.0), takes pre-fetched bytes and font buffers | Adopt; `queryFonts` must never be `'localandremote'` |
| `libbitsub` | `1.13.2` published 2026-11-01, MIT, takes pre-fetched bytes | Adopt for PGS, VobSub and DVB |
| Media Source Extensions | W3C API; `ManagedMediaSource` required on iPhone 17.1+ | No dependency; probed at run time |

The playlist vectors already exist (`packages/core/tests/fixtures/hls-playlists.json`), so the TypeScript validator starts from the same suite Kotlin is held to.

## Milestones

0. **Falsifiers, before any task is written, in this order.** (b) first: append an fMP4 HLS stream from Jellyscale to MSE through hls.js with a header-injecting loader, at 4K remux bitrate, in Chromium, Firefox and Safari, and on an iPhone through `ManagedMediaSource`; record the quota behaviour and the highest bitrate each plays without a stall. It runs first because it says whether a film plays at all, and its figure is the bitrate ceiling milestone 1 needs; no ceiling is written down before it is measured. (a) second: export `apps/tv` with `expo export --platform web` and open it at 1920×1080, 1280×800 and 390×844 with a mouse and a keyboard; record first content, 60 s idle memory, focus latency and scroll frames against `docs/research/web-client.md` §4's thresholds, and count the files that need web variants (target ≤12 of 45). (c) last, one day at most: measure whether a service worker can serve a same-origin `<video src>` with the header in Chromium, Firefox (bug 1923096) and Safari, with a security note. Validation: the three results are pasted here. Model: opus. **Gates:** if (b) fails in a v1 browser, that browser leaves v1 or the plan stops; if (a) fails, the UI is a React DOM app on `packages/core`; (c) changes nothing in v1, whatever it finds: v1 needs one engine that works in every v1 browser, and "no service worker" is part of decision 0006's promise. A success in (c) becomes a backlog line for an "original file on the web" path after v1, and the owner decides it, because it amends 0006.
1. **Negotiation learns the two dimensions it lacks.** A per-device **bitrate ceiling** in the capability report, acted on by the source decision; containers judged for the container-only remux case; and rule 5 turning off copy only for the stream that cannot play. The ceiling is a device capability, read by the source decision and never written into the DeviceProfile; it has its own reason and copy, apart from the viewer's streaming limit. Jellyscale must honour and echo the copy flags — it reads none today — and must give a reason whenever it reduces the channel count. Both are Jellyscale issues Octave files; the wire test waits for them (`AGENTS.md`, "Pass a playback task only when its wire test passes against Jellyscale"). Whether Octave's profile should also carry `MaxAudioChannels` is this milestone's spec to settle against `ARCHITECTURE.md` §3; the downmix reaches the TV's HLS sessions today (backlog). Validation: core tests; the tripwire count of copies against re-encodes improves; a Jellyscale wire test asks for copy and gets fMP4 HLS. Model: opus.
2. **Decision 0006 and the product text.** The token in page memory or one `localStorage` record; `BroadcastChannel` sign-out; the shared-computer mode; XSS as the boundary; the CSP; no service worker; what is never persisted; the test for each. The record must make the promises listed under "What decision 0006 must promise", and the owner accepts it, as the owner accepted 0005. `PRODUCT.md` gains the web form, its single-origin rule and its media limits; `DESIGN.md` gains the web form's pointer, layout and type rules; `docs/security.md` gains the web section; I7's image wording is amended for pictures by id. Validation: `gate: review`. Model: fable for the decision, opus for the text.
3. **The web host and the token's owner (`packages/web-host`).** A host owning the token in a `#private` map, exposing the existing `Transport` plus `mediaFetch(session, path, range, signal)` with `credentials: "omit"`, `redirect: "manual"`, `referrerPolicy: "no-referrer"`, same origin only. Session record, install id, device preferences, WebCrypto. Password sign-in. `authorizationHeader()` removed. Validation: Node tests for the host and the storage allowlist; a Chromium run that signs in and renders Home against the fixtures image. Model: opus.
4. **The engine.** The `PlayerEngine` port over hls.js: the plan from negotiation; a validated playlist through the shared vectors with every `ApiKey` stripped on rebuild; a custom loader that adds the header and refuses a foreign origin; a byte budget with early `remove()`, small fragments, and a `QuotaExceededError` path; a watchdog for silent non-progress; seek, buffering, recovery; `ManagedMediaSource` on iPhone with `disableRemotePlayback`. Capabilities probed per exact codec string, with `passthrough: []` and the bitrate ceiling. Every playlist hls.js loads, a reload of a media playlist included, passes the validator inside the loader; hls.js is pinned to an exact version and never given a URL it may fetch by itself. Validation: shared vectors in TypeScript; a Chromium e2e plays a copied MKV, a transcode and a fragmented MP4, seeks and switches audio; an iPhone check of the MMS path. Model: opus.
5. **Subtitles on the client.** WebVTT drawn in Octave's overlay; ASS through JASSUB with the film's attachment fonts; PGS, VobSub and DVB through libbitsub; burn-in requested only when a renderer is unavailable or too slow, and then shown as a conversion. Validation: a film with an ASS track and one with PGS play with the right fonts and no network request outside the origin; the burn-in fallback is exercised once. Model: sonnet with an opus review.
6. **Browse and input.** The screens through React Native Web (or a DOM app if milestone 0 failed): responsive layout, the web type ramp, roving focus in rows, `:focus-visible` with a ring that also works without it, hover, history and Back, real URLs. Validation: captures at three sizes; a keyboard-only pass; `DESIGN.md` review. Model: sonnet with an opus review.
7. **OIDC.** Jellyscale as the confidential client. The routes are Octave's proposal on Jellyscale's JS-039; their shape is Jellyscale's to decide, and Octave's requirements are four: no cookie (Jellyscale invariant 63, `DOMAINS.md:185`), no identity-provider token in the page, a one-time code bound to a verifier the tab made, and HTTPS. As proposed: `POST /jellyscale/v1/oidc/start {handoffChallenge}` answers the sign-in URL; the callback answers `303 {the base path the client was served from}#sso=<one-time code, 60 s>`; `POST /jellyscale/v1/oidc/token {handoffCode, handoffVerifier}` answers the usual authentication result. The verifier lives in `sessionStorage`; the page never sees an IdP token; expiry is a page-level sign-in; sign-out revokes and reaches other tabs. HTTPS only. A page-level sign-in returns the viewer to the title they were on, with Resume; the position is the one the progress reports already saved. On plain HTTP the sign-in step offers a password and says: "Single sign-on needs HTTPS. Sign in with a password, or open this server over HTTPS." An account with no password has no way in over plain HTTP in v1; Quick Connect in the browser would give it one (backlog). Back-channel logout is not asked for in v1. Validation: the wire test with a test identity provider — no `Set-Cookie`, no token in a URL, the provider navigation the only redirect, sign-out revoking and propagating. Model: opus, fable reviewing the boundary.
8. **Serving, packaging and cutover.** A static handler in Jellyscale: history-API fallback from memory with `no-cache` and an ETag, hashed assets `immutable`, precompressed `.br`/`.gz`, `version.json` `no-store`, the CSP and security headers, and the three seams (`normalize`'s lowercase exclusion, `crossOrigin`, `logRequests`). One build with relative asset URLs serves any prefix. Octave's part ends at a build that serves from any prefix and passes Octave's own tests at `/octave/`. The static handler, what sits at `/web/`, and whether Jellyscale's `test/e2e` drives Octave are Jellyscale's, and need its owner (D-027). Octave's recommendation: jellyfin-web stays at `/web/` for as long as Jellyfin Desktop, Jellyfin for webOS and the TV's QR link load it, and Octave lives at `/octave/` with the root redirect a setting. Validation: Octave's wire and browser tests green against the pinned Jellyscale at `/octave/` and at one other prefix. Model: opus.
9. **Hardening.** iPhone and iPad figures, low-memory sessions, Safari's buffer eviction, the service-worker finding if milestone 0 (c) pursued it, accessibility, and performance budgets measured. Validation: budgets recorded with their runs; a security review. Model: opus.

Each milestone's work gets its own spec in `docs/specs/<TASK-ID>.md` before implementation. The T17 tasks do not exist in `tasks/prd.json` yet: a Product Owner pass adds them, and this plan does not.

## What decision 0006 must promise

Product Owner's bar of 2026-11-26, for the owner's veto. The owner accepts the record itself.

1. **It opens with the loss, in one plain sentence:** on the web, JavaScript holds the token, so any script that runs in the page can take the account. Decision 0005 stands unchanged for every native form, and no native code may cite 0006.
2. **Where the token is.** In one private holder in the web host, and in at most one named `localStorage` record. Never in a URL, a DOM attribute, React state or a prop, history state, a log, an error, a `BroadcastChannel` message (which carries only "signed out"), or the preferences record.
3. **Staying signed in is a visible choice at sign-in**, on by default: "Stay signed in on this computer", with "Turn this off on a shared computer. You'll be signed out when you close the tab." Off means memory only. On by default because `PRODUCT.md` says Octave stays signed in, and a reload must not sign a viewer out; the owner may prefer off.
4. **Sign-out** revokes the token on the server, clears the record, and signs out every other tab. A confirmed 401 is final.
5. **Never present:** a service worker, a refresh token, an identity-provider token, a cookie, a third-party script, font or request.
6. **The CSP comes from the server**, with `connect-src 'self'`, no inline script and no `eval`. The record says what is lost when a proxy strips it.
7. **What remains, named:** an XSS or a bad dependency takes the account; so does a browser extension or another person on the same browser profile; the record is plaintext in the browser's profile; Jellyscale's tokens have no expiry (`docs/research/web-client.md` §3, "as read").
8. **One named test for each promise**, in `docs/security.md`.

## What Octave asks Jellyscale for

Octave files issues; it does not decide Jellyscale's work. D-027 (Jellyscale `tasks/decisions.json:305-312`, by its owner) says no Jellyscale task aims to make Octave work, and keeps features "where they serve viewers on jellyfin-web or any client".

| Ask | Serves any client? | Ruling |
|---|---|---|
| Honour and echo the five PlaybackInfo flags | Yes: Jellyfin 12.4 defines them and jellyfin-web sends `EnableDirectPlay` | **Ask**, as parity |
| Give a reason whenever the channel count is reduced (`internal/playback/decide.go:686` falls to 2 with no `MaxAudioChannels`) | Yes: a silent downmix reaches any client whose profile omits it | **Ask**, as a bug |
| OIDC without a cookie: a handoff a browser tab can bind | Yes: invariant 63 already binds JS-039, and a static login link cannot make a verifier | **Ask**, as a proposal on JS-039; the route shape is Jellyscale's |
| Serve Octave's build: history fallback, cache headers, CSP, precompressed assets, the three seams | No: it is work for Octave | **Needs Jellyscale's owner** (D-027; Jellyscale `PRODUCT.md:83`, "no jellyscale work goes in for it") |
| Move Jellyscale's e2e tier to Octave | No: D-027 forbids running Octave against Jellyscale | **Needs Jellyscale's owner** |
| Delivery variants on `/jellyscale/v1/items/{id}/playback-info` | No, today | **Not asked.** v1 does not need it; it returns if D-027 is lifted or a second client wants it (backlog) |
| Back-channel logout | Yes | **Not asked in v1** (backlog) |

A browser-shaped source for `MaxAudioChannels` and the bitrate ceiling is Octave's side; the server only has to report what it did.

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
- 2026-11-26: A new phase (T17). Reason: the browser brings its own engine and identity work. Whether the desktop (T16) derives from it is not decided here: T16-01 is the owner's decision, and its acceptance rules react-native-web out (Product Owner pass, 2026-11-26).
- 2026-11-26: **hls.js behind the port**, reversing the earlier "own engine" decision. Reason: its loader can add the header (`xhrSetup`, unused by jellyfin-web), it carries the buffer and Safari/MSE edge cases that a hand-rolled engine would rediscover, and `BUFFER_APPEND_NO_PROGRESS` covers the silent Firefox failure. Playlists still pass the shared vectors before it sees them.
- 2026-11-26: The web form talks only to the origin that served it. Reason: it removes discovery, server choice, CORS and mixed content and makes `connect-src 'self'` enforceable.
- 2026-11-26: One shared session record rather than memory only, with a shared-computer mode. Reason: Jellyscale deletes a device's previous token at sign-in (`internal/api/users.go:154`), so tabs would evict each other and a reload would sign the viewer out.
- 2026-11-26: Client-side ASS and PGS rendering, with burn-in as a visible fallback. Reason: JASSUB and libbitsub are maintained and take pre-fetched bytes, and burn-in forces a video transcode.
- 2026-11-26: TV browsers and the Jellyfin shells are out of v1. Reason: Tizen caps MSE at FHD, Desktop is a jellyfin-web host with its own mpv contract, and webOS needs a manifest and shim; each is a separate product decision.
- 2026-11-26: Images by item id through `<img>`, trickplay with the header. Reason: both servers serve pictures by id without a token by design, and a header fetch would bypass the browser cache; I7's wording is amended, not abandoned. The amendment changes an invariant, so the owner accepts it with decision 0006.
- 2026-11-26, Product Owner pass (provisional, for the owner's veto; `tasks/product-owner-log.md`, "2026-11-26, plan 017 pass"): v1's scope confirmed, with a designed notice and no user-agent refusal; the single-origin rule confirmed; the web wording table added; the bar for decision 0006 set, with the owner accepting the record; OIDC's cost accepted; Octave's part of the cutover ends at `/octave/`, and `/web/` and Jellyscale's e2e are Jellyscale's owner's; delivery variants and back-channel logout not asked for; hls.js, the bitrate ceiling and client-side subtitles confirmed as architecture; the falsifiers kept and reordered (b), (a), (c), and (c) can no longer overturn v1.

## Surprises & discoveries

- Progressive MP4 is not merely unreliable in MSE: Chrome errors and Firefox fails silently (`docs/research/web-client.md` §1).
- Browser buffers are ten seconds at 4K remux bitrates, so a bitrate ceiling is a capability, not an optimisation.
- No web API can request or confirm audio passthrough, so lossless audio cannot reach an AVR from a browser.
- Jellyfin itself puts the token in subtitle and trickplay URLs, which is why every surveyed browser client does.
- `packages/core/tests/fixtures/hls-playlists.json` already exists, so the TypeScript validator inherits the vectors.
- Jellyscale reads none of the five PlaybackInfo flags, though Jellyfin 12.4 defines them all.
- Jellyscale's D-027 and its `PRODUCT.md:83` say no Jellyscale work goes in for Octave, so the static handler and the e2e move are not parity asks; they need Jellyscale's owner.
- The TV's Quick Connect QR code links to `/web/#/quickconnect`, so `/web/` is part of Octave's own sign-in.
- T16-01's acceptance rules react-native-web out as a desktop route, on its author's statement; this plan's dependency check did not answer it.
- The DeviceId needs SHA-256 and plain HTTP has no `crypto.subtle`.

## Validation evidence

## Outcome & retrospective
