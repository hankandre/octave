# The browser client: what the evidence says

Research for plan 017, 2026-11-26. Seven independent investigations: browser media capability (with local tests), prior art in existing clients, OIDC in a cookie-less SPA, React Native Web, Jellyscale's playback API, serving a SPA from Jellyscale, and TV/embedded browsers.

Every claim names its source or is marked **unverified**. The local media tests ran on one Linux host, headless Chrome 157 and Playwright Firefox 157; they are not platform claims.

## 1. Playback in a browser

### Containers

| Container | Chrome | Firefox | Safari |
|---|---|---|---|
| Fragmented MP4 (ISO BMFF, `mvex`/`moof`) | plays (tested) | plays (tested) | yes |
| **Progressive MP4** (`moov` + `mdat`, unfragmented) | **append error**: "Detected unfragmented MP4 … require ISO BMFF moov to contain mvex" (tested) | **silently buffers nothing**: `updateend` fires, `buffered` empty, never plays (tested) | **unverified**; parser is Apple's closed `AVStreamDataParser` |
| Matroska | rejected (tested) | rejected (tested) | **unverified** |
| MPEG-TS | accepted (tested), build-flag gated | `NotSupportedError` (tested) | **unverified** |

The MSE ISO-BMFF byte stream format requires an init segment with `mvex` and media segments of `[styp] moof mdat` (W3C editor's draft). A whole progressive file appended as one buffer is not that.

**Consequence.** "Direct play" in a browser means fragmented MP4 or WebM only. Everything else needs remuxing — by the client (a JavaScript demuxer, which also fixes absolute sample offsets) or by the server (Jellyfin's DirectStream).

**A silent-failure trap.** Firefox reports no error for a bad append, so a client needs a watchdog: `updateend` with `buffered` not growing is a failure. hls.js 1.7.0 added `BUFFER_APPEND_NO_PROGRESS` for this symptom.

### Codecs

Probe the exact codec string at run time (`MediaSource.isTypeSupported` and `decodingInfo({type:'media-source'})`); never a user-agent table.

- **Dependable baseline:** H.264 8-bit and AAC in fMP4.
- **Probe:** AV1, VP9, Opus, FLAC, HEVC. HEVC is hardware-gated and differs per machine: the headless Linux run said no in Chrome, yes in Firefox. Jellyfin's own table has the platform detail.
- **AC-3/E-AC-3:** Safari yes; Edge per machine (Windows 11 24H2 no longer ships AC-3); desktop Chrome no (compiled only for Cast/tvOS).
- **DTS, DTS-HD, TrueHD:** rejected in both tested engines, and **no web API can request or confirm bitstream passthrough**. Lossless audio cannot reach an AVR from a browser.
- **HDR:** Safari on HDR displays, Chrome Windows/macOS (PQ/HLG), Firefox 153+ on Windows with AMD/NVIDIA. No Linux. Dolby Vision: Safari including profile 5; elsewhere only the compatible base layer, and sources conflict on Edge. `decodingInfo` describes decode, not the display on the glass — pair it with `matchMedia('(dynamic-range: high)')`, and never claim HDR output was confirmed.

### Buffers

| Engine | Video quota | Seconds at 80 Mbps |
|---|---|---|
| Chromium desktop | 150 MiB (30 MiB low-end); tested: 136 MiB accepted, then `QuotaExceededError` | ~16 s |
| Firefox | 150 MiB default; tested: 155.5 MiB, then quota error | ~16 s |
| Safari macOS | ~289 MiB | ~30 s |
| Safari iOS | ~100 MiB | ~10 s |

Quotas shrink under memory pressure and cannot be queried. A 4K remux is **seconds** of buffer, not minutes: the engine must budget in bytes, append small fragments, trim behind, and treat `QuotaExceededError` as normal.

### iPhone

No `MediaSource` on iPhone; `ManagedMediaSource` from iOS 17.1, and Safari opens it only if `disableRemotePlayback = true` or an AirPlay `<source>` exists — so AirPlay through this path is given up. The user agent may evict at any time; `startstreaming`/`endstreaming` say when to fetch.

### Subtitles

- WebVTT via `TextTrack` is native; `::cue` styling is limited. A `<track src>` cannot send the header, so fetch the text and add cues, or draw an owned overlay for exact styling.
- **ASS/SSA:** `jassub` 2.5.38 (2026-11-16) takes pre-fetched bytes and font buffers. Keep `queryFonts` away from `'localandremote'` — it calls Google Fonts, which breaks "no third-party services". `@jellyfin/libass-wasm` 4.2.4 (2026-01-13) is what jellyfin-web uses; upstream SubtitlesOctopus is stale (4.1.0, 2022).
- **PGS/bitmap:** `libbitsub` 1.13.2 (2026-11-01, Rust/WASM, also VobSub/DVB) and `libpgs` 0.9.0 (2026-08-27) take pre-fetched bytes.
- Burn-in forces a video transcode and is the costliest path; make it a visible fallback, not the default.
- Untested: renderer performance at 4K, and overlay behaviour in native fullscreen or PiP.

### The premise worth testing once

A **service worker** might add `Authorization` to a same-origin `<video src>` with no token in the URL, which would restore the browser's own progressive playback and buffer management. Firefox bug 1923096 (open, 2026) says `<video src>` is not intercepted, with `crossorigin="anonymous"` reported as a workaround; Range/206 handling must be exact for Safari; the worker would hold the token. **Not tested, and it needs a security review.**

## 2. What existing clients do

| Client | Token | Media transport | Lesson |
|---|---|---|---|
| jellyfin-web | `localStorage["jellyfin_credentials"]` | `<video src>` with `ApiKey=` in the URL; hls.js 1.7.4 sets only `withCredentials` in `xhrSetup` — the header hook exists and is unused | The leak is ordinary, not necessary |
| Jellyfin Vue | `localStorage["auth"]` | MSE-first; builds direct URLs with lowercase `api_key`, the spelling Jellyfin 12 dropped | MSE-first is viable |
| Streamyfin | SecureStore **plus a plaintext copy in unencrypted MMKV** | On web its player is an `<iframe src={mediaUrl}>` stub | A "secure" token store can be undone elsewhere |
| Findroid | — | Builds the stream URL with **no token** and configures no header (grep) | Cannot play from a header-only server at all |
| Jellyfin Desktop | jellyfin-web's | Hands mpv the same tokenised URL; redacts `api_key` in logs | It is a jellyfin-web host, not a browser |
| Moonfin (SolidJS, Tizen/webOS/Xbox) | URL token, name parameterised per server | `<video>`/AVPlay/Starfish/hls.js | The best URL-token client; still a URL token |
| jellyfin-android | `Authorization` via `ResolvingDataSource`, scoped to the server's authority | native | The prior art that gets it right |

**Where the token in a URL comes from:** the server. Jellyfin appends `?ApiKey={token}` to subtitle `DeliveryUrl`s (`StreamInfo.cs:1276-1280`), to `TranscodingUrl` (`MediaInfoHelper.cs:312,325`) and inside HLS subtitle and trickplay playlists (`DynamicHlsHelper.cs:694,746`). A client that wants header-only auth must rebuild those URLs without the parameter — which is what Octave already does on the TV.

**OIDC in this ecosystem is new ground:** the only Jellyfin OIDC plugin was archived on 2026-05-12.

## 3. OIDC without cookies

- **RFC 10017** (August 2026) is the browser-based-apps guidance: it **discourages** tokens in the browser for apps holding personal data but does not forbid them, and it forbids the implicit grant. OAuth 2.1 is still a draft.
- **Flow (backend-for-frontend):** Jellyscale is the confidential client. `POST …/oidc/start {handoffChallenge}` answers the sign-in URL; the callback answers `303 /web/#sso=<one-time code, 60 s>`; `POST …/oidc/token {handoffCode, handoffVerifier}` answers the usual `AuthenticationResult`. The verifier lives in the tab's `sessionStorage` and does the browser-binding job a cookie would. The page never sees an IdP token. A static "login link" (the current JS-039 plan) cannot create that verifier.
- **Storage:** `localStorage` on trusted computers (a deliberate OWASP exception), memory only on a shared one. IndexedDB or a worker adds little. **Plain HTTP has no `crypto.subtle`**, so OIDC is offered over HTTPS only; password sign-in remains for a plain-HTTP LAN server.
- **Renewal:** no iframe renewal, no refresh tokens, no DPoP. Expiry means a whole-page sign-in. Treat a confirmed 401 as final; revoke on the server; use `BroadcastChannel` and `storage` events only to keep tabs in step; add OIDC back-channel logout.
- **CSP:** the server must set it — a `<meta>` tag cannot set `frame-ancestors`, `sandbox`, `report-uri`, or Report-Only. Worker scripts need `'wasm-unsafe-eval'` on their own responses.
- **Risks that remain:** an XSS or a bad dependency takes the account, and CSP cannot stop a leak by navigation. Jellyscale stores tokens in plaintext with no expiry column (as read). A token in a media URL survives in logs and history; scoped playback grants would bound it.

## 4. React Native Web

- **The tree would crash on web today**, not merely misbehave: `TVFocusGuideView` and `useTVEventHandler` are not exported by RNW, and `findNodeHandle` throws. Elsewhere it fails silently: `requestTVFocus`, `nextFocus*` and `hasTVPreferredFocus` do nothing; `BackHandler` never fires; `px()` ignores a resize.
- RNW 0.21.4 tracks no particular React Native version, and Expo swaps the import name on web, so the `react-native-tvos` alias is probably not a problem.
- FlashList, screens, safe-area and React Navigation have web code; TV behaviour is untested. The app's source does not import Reanimated.
- The full RNW package is 76 kB gzipped. No controlled 2026 comparison with React DOM was found.
- Cost of a separate DOM app: about 3,700 lines in files importing native UI, plus tests, plus building library, detail, search and settings twice.
- Suggested gate (2–3 days, at 4× CPU slowdown): first contentful paint ≤1.5 s, ≤100 MB after 60 s idle, focus p95 ≤50 ms, ≥95% of scroll frames ≤33 ms, no errors in 500 key presses, ≤12 of 45 files needing web variants. **These numbers describe a desktop browser**; a TV browser needs real hardware.

## 5. Jellyscale's playback API

- **None of the five PlaybackInfo flags is read** (`EnableDirectPlay`, `EnableDirectStream`, `EnableTranscoding`, `AllowVideoStreamCopy`, `AllowAudioStreamCopy`), though all five are in Jellyfin 12.4's schema and jellyfin-web sends `EnableDirectPlay`. Honouring them is parity, not a new feature.
- Octave's profile sets **no `MaxAudioChannels`**, so HLS audio with more than two channels becomes AAC stereo, often with no reason given.
- A delivery-variants array on `/jellyscale/v1/items/{id}/playback-info` is feasible (roughly 250–350 production lines, no queue or schema change) but **conflicts with Jellyscale's D-027 policy** ("no feature built for one client") unless the owner lifts it.

## 6. Serving the client from Jellyscale

- Today `/web/` is four lines of `http.FileServer` (`internal/api/server.go:184-188`); deep links such as `/web/item/abc` answer 404, which nobody notices because jellyfin-web is hash-routed.
- Three seams must learn a new prefix: `normalize` lowercases every path outside `/web/` (so `assets/App.js` would 404), `crossOrigin` excludes `/web/` so the app's own files get no `Access-Control-Allow-Origin`, and `logRequests` skips `/web/`.
- Nothing sets `Cache-Control` or `ETag` today, and nothing compresses. Hashed assets should be `immutable`, `index.html` `no-cache` with an ETag, and `version.json` `no-store`. Precompressed `.br`/`.gz` is the cheapest large win; compression must never touch media routes, where `Range`/`If-None-Match` matter.
- The CSP header, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` must come from the server.

## 7. TV and embedded browsers

| Platform | Engine | MSE | Notes |
|---|---|---|---|
| LG webOS 22 / 23 / 24 / 25 / 26 | Chromium 87 / 94 / 108 / 120 / 132 | yes | 4K video supported in web apps |
| Samsung Tizen 2022 / 2023 / 2024 / 2025 / 2026 | M85 / M94 / M108 / M120 / M130 | yes, **FHD only** | UHD needs AVPlay, which a web page cannot reach |
| Jellyfin Desktop | jellyfin-web host | — | Injects `window.jmpInfo`, QWebChannel `window.api`, an mpv plugin needing `window.playbackManager`; `extractBaseUrl()` assumes `/web` |
| Jellyfin for webOS | loads `/web/` | — | Requires `/web/manifest.json`, injects `NativeShell`/`AppInfo`, runs its own key navigator |
| Jellyfin for Tizen | bundles jellyfin-web | — | Does **not** load `/web/`; a new wrapper would be needed |

- `ManagedMediaSource` exists only in Safari, so every TV Chromium uses plain MSE.
- No spatial navigation exists in the DOM: a client implements D-pad focus itself.
- `:focus-visible` is Chrome 86+, so **absent on Tizen 2022** (M85).
- **Consequence:** pointing `/web/` at Octave breaks Jellyfin Desktop (its mpv contract and settings are jellyfin-web's) and webOS (which needs `manifest.json` plus a shim), and does nothing for Tizen (which bundles its own copy).

## What this changes

1. Web playback is fMP4 HLS, and "original file" on the web is rare; the honest sentence is "repackaged on the server" for most films, or "repackaged in your browser" if a client-side remux is ever built.
2. A per-device **bitrate ceiling** is part of the web engine's capability report, not a polish item: a 4K remux exceeds every browser's buffer.
3. hls.js with a header-injecting loader is the lower-risk engine; the shared playlist vectors still gate what it is given.
4. Client-side ASS and PGS rendering is viable and better than burn-in, with fonts from the server's attachments and no remote font fetch.
5. OIDC is a backend-for-frontend handoff, not a browser token dance, and it is HTTPS-only.
6. TV browsers and the Jellyfin shells are out of scope for v1; the cutover must keep jellyfin-web reachable for them.
