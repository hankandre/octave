# Architecture

This is the top-level architecture: the stack, the system shape, the two playback engines, how Octave uses the Jellyfin API, and the invariants that must hold. For domain boundaries, see `DOMAINS.md`. For the token and network boundary, see `docs/security.md`.

Decisions behind it: [0001](docs/decisions/0001-private-lan-http.md) (plain HTTP on the home network), [0002](docs/decisions/0002-server-transcoding-fallback.md) (original first, honest fallback, amended 2026-11-20 for per-device playback), [0003](docs/decisions/0003-tv-and-mobile-shell.md) (the TV shell and its engines; its "Decision (accepted)" section wins) and [0004](docs/decisions/0004-tv-shell-go-no-go.md) (go with React Native, with conditions) and [0005](docs/decisions/0005-token-boundary.md) (the token lives in native memory only). Items marked **[unverified]** need a fixture or a device check before they are relied on. A path or command marked with a task id does not exist yet; that task adds it.

---

## 1. Stack

### Verdict: React Native for TV, a shared TypeScript core, native players. Never Flutter.

Decisions 0003 and 0004 (accepted 2026-11-20):

- **Shell.** Expo SDK 58 with react-native-tvos 0.88.x, in TypeScript. It is the only option that reaches Android TV and tvOS with one UI and keeps one implementation of the TypeScript rules. The browse UI is React Native. In the player the picture is native and the controls are React Native views over it ([decision 0003](docs/decisions/0003-tv-and-mobile-shell.md), amendment of 2026-11-26).
- **Core.** The TypeScript core (domain, Jellyfin gateway and negotiation, coordinator, playstate reporter, redaction) is kept and runs unchanged under Hermes with three host additions: Expo's built-in URL (`whatwg-url-minimum`, installed by Expo's runtime), `expo-crypto` behind the Crypto port, and the session module's transport (`apps/tv/src/host/transport.ts`, T3-05) behind the Transport port (decision 0004, "Play"; T3-02).
- **Engines.** Android: Media3 first (HDR, Dolby Vision, passthrough); libmpv later as the second engine, for original files Media3 cannot decode (T13). Apple TV (T14): decided when that phase starts, each engine checked against the maintenance rule.
- **No Rust layer and no FFI.** The desktop app's playlist rules became the shared vectors in `packages/core/tests/fixtures/` that every validator must pass, and its mpv options became `docs/mpv-options-checklist.md`.
- **Order.** Android TV first, Apple TV kept possible, then phones and tablets (T15), then the desktop (T16, route undecided).

### Conditions that shape the work (decision 0004)

1. A Baseline Profile in every release build (T3-13).
2. A performance budget set by the owner and enforced (T3-12).
3. A cheap Google TV box before the browse screens (T0-06).
4. Image loads started off the main thread (T3-11, T3-14).
5. The focus fixes carried into rows and the rail (T3-08, T3-09), and the 500-press focus test as a required CI check (T3-10).
6. HDR10 output and passthrough proven before the playback phase is called done (T8-21).
7. One Fire TV device tested before Fire OS is promised (T11-08).

### Revisit if

- A cheap box cannot meet the memory budget with any acceptable design (decision 0004, "What would lower this to no-go").
- react-native-tvos stops passing the maintenance rule, or its out-of-tree move costs more than one migration.
- The owner judges the React Native build wrong from the sofa in a way the measured fixes do not repair.

The replacement named by decision 0004 is native Kotlin with Compose for TV; it has no Apple TV path and would need the core ported or bridged.

---

## 2. System shape

```text
┌──────────────────────────── apps/tv (Expo + react-native-tvos, T3-01) ────────────────────────────┐
│  Screens: sign-in · home · library · search · detail · settings        (React Native, TypeScript) │
│                      │ use cases, typed errors                                                     │
│  ┌───────────────────▼──────────── core (TypeScript, no platform APIs) ─────────────────────────┐  │
│  │ domain         pure types and rules: policy, host classes, start choice, track choice         │  │
│  │ jellyfin       gateway, DeviceProfile, source decision, HLS URL rebuild                        │  │
│  │ player         coordinator, playstate reporter, session state                                  │  │
│  │ ports          Transport, PlayerEngine, Clock, Crypto, stores; holds a session id, no token    │  │
│  └──────┬─────────────────────────────────────────────────────────────────┬───────────────────────┘  │
│         │ Transport port (T2-04; Android: T3-05)                           │ PlayerEngine port (T2-05) │
│  ┌──────▼──────────────────────────────┐            ┌─────────────────────▼─────────────────────┐   │
│  │ native HTTP module (Kotlin, T3-03)  │◄───────────│ modules/player (Expo module, T8-01)        │   │
│  │ one OkHttp client: header for the   │  every     │ Media3 + Octave's media source factory     │   │
│  │ signed-in origin, no redirects,     │  native    │ HLS playlist parser hook (T8-08)           │   │
│  │ no proxy, other origins refused     │  request   │ libmpv for originals only (T13)            │   │
│  └──────▲──────────────────────────────┘            └────────────────────────────────────────────┘   │
│         │ artwork by item, type, tag and size (T3-11)                                                │
└─────────┴────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Where the code is today.** The core lives in `packages/core/src/domain/`, `packages/core/src/jellyfin/`, `packages/core/src/player/`, and `packages/core/src/` (redaction, safe reasons, transport errors, preference and confirmation ports), with its tests beside it and the shared fixtures in `packages/core/tests/fixtures/`. It is the pnpm workspace package `@octave/core` (T2-02). `apps/tv` is the TV app (T3-01): its Expo config, the composition root over the app shell (`apps/tv/src/shell/`, T3-09: the native stack, the collapsed side rail, Back and `routes.ts`), and a placeholder screen every route shows until its own task. It depends on the core as `@octave/core` and holds the host adapters in `apps/tv/src/host/` (`hostClock`, `hostCrypto` over `expo-crypto`; T3-02); an e2e build adds `apps/tv/src/e2e/`, which the release bundle never holds. `modules/session` is the native session module (`@octave/session`, T3-03): an Expo module with no JavaScript surface yet that owns the one authenticated OkHttp client in `dev.octave.session.http`. `modules/install-id` is the install id store (`@octave/install-id`, T4-09): an Expo module with one function, `keep`, that keeps the install id in the app's no-backup directory. `modules/preferences` is the preferences record store (`@octave/preferences`, T9-02): an Expo module with two functions, `read` and `write`, that keeps the device's one non-secret preferences record, `octave-preferences.json`, in the app's no-backup directory and accepts only that record's exact shape; the TV's store over it is `createDevicePreferenceStore` in `apps/tv/src/host/preferences.ts`, wired as `hostPreferences`. The per-account preferences (auto-play and its countdown, the skip modes, the Continue watching window) are on the server's display preferences (T9-09): the gateway's `accountPreferences` and `saveAccountPreferences` (mapping in `packages/core/src/jellyfin/account-preferences.ts`), and the TV store reads and saves them through `useAccount` and `saveAccount`. `modules/player` is the player module (`@octave/player`, T8-01): an Expo module whose surface is the PlayerEngine port's six commands, the `playerEvent` event and a native view with no prop, over the plain-Kotlin seam `dev.octave.player.seam` (`PlaybackEngine`, `PlayerSeam`, `LaunchRequestReader`). Behind it since T8-02 is the Media3 engine, `dev.octave.player.media3` (`Media3Engine`, `Media3Handle`) over the plain-Kotlin rules of `dev.octave.player.engine` (`EngineCore`, `PlaybackErrors`, `DecoderFacts`): one ExoPlayer per launch over Octave's media source factory and the one client, which plays original files, and an HLS launch answers `unsupported-request` (T8-08). The capability probe (T8-07) answers `initialize`: `DevicePlatformReader` and `PlatformNames` in `dev.octave.player.media3` read Media3's decoder lists per codec and profile, the default display's HDR types and Media3's passthrough answer, and the plain-Kotlin `CapabilityMap` and `CapabilityProbe` in `dev.octave.player.engine` turn that into the port's list (one entry per profile a decoder plays) or "cannot tell". While a launch is loaded and has neither ended nor failed, the engine reports its position once a second (T8-03): `Media3Engine` posts a runnable on the main looper every `POSITION_TICK_MILLIS` (1000 ms), and `EngineCore.tick` emits a `state` event with cause `property`. Since T8-04 the same event goes out when a loaded launch starts and stops buffering, the snapshot carries the buffered position, and `PictureState.awake` reaches `OctavePlayerView` through `PictureSlot`, which sets `keepScreenOn` while a launch plays. A viewing is `Viewing` in `packages/core/src/player/viewing.ts` (T8-03): it reads the item, runs it through the coordinator, holds what a player screen shows, pauses, resumes and seeks it through the engine port (T8-04), leaves it on Back once the engine has stopped, and names the title once it has ended; `playbackGatewayOf` in `packages/core/src/jellyfin/playback-gateway.ts` makes the gateway its source. `SignedInApp` in `apps/tv/src/signed-in/signed-in-app.tsx` is the composition for a signed-in gateway: it builds the viewing over the gateway and a given engine, gives Home its play and the player screen (`apps/tv/src/player/`: React controls, remote keys and status over the native view) its services, and draws the shell, whose `ShellApi.close` closes the player when a title ends. `App.tsx` does not mount it yet, because the app has no finished sign-in (T4-03). The first sign-in step, choosing a server, is built (T4-02): `SignInApp` in `apps/tv/src/sign-in/` is the signed-out composition, with no shell and its own Back listener; it draws the server step and then the later step it is given (T4-03), under which `SignInStepFrame` shows the chosen server's address. `probeServer` in `packages/core/src/jellyfin/server-probe.ts` builds the gateway and sends only the tokenless public-info request, and `packages/core/src/domain/server-choice.ts` holds the failure codes, the completion of an address typed with no scheme and the order of the rows. The remembered servers (`RememberedServers` in `packages/core/src/remembered-servers.ts`) and the unencrypted-connection confirmations are in memory for one launch, wired in `apps/tv/src/host/host-sign-in.ts` with a discovery source that finds none (`apps/tv/src/host/discovery.ts`; T4-01 supplies the native one). `App.tsx` does not mount `SignInApp` either (T4-03). The app's adapter is `createPlayerEngine` in `apps/tv/src/host/player-engine.ts`; every gateway the app builds probes the device once through it (`createAppGatewayFactory` in `apps/tv/src/host/gateway.ts`, `createCapabilityProbe` in `apps/tv/src/host/device-capabilities.ts`), and the app cannot be composed without that probe.
- **The core is platform-free.** It takes its host through ports: a `Transport` for HTTP (T2-04: no axios and no SDK), `Clock` and `Crypto` (T2-03), and the stores. The host contract is `packages/core/host-globals.d.ts`: the package compiles without Node's types, so every global the core reads is declared there. The ports are in `packages/core/src/ports/` and the reference adapters for Node tests and the tripwire are in `packages/core/src/adapters/`.
- **The token lives in native memory only (decision 0005).** Kotlin sends and parses the two sign-in calls and keeps `AccessToken` in a session registry keyed by an opaque 128-bit session id; JavaScript holds only that id. The core still builds every catalog request (path, query, body) and parses every response; Kotlin adds the header, sends it, and strips the session's token value (as written and percent-encoded) from the body before it crosses back. The native session surface is four methods and one event (the core's port has `signIn`, `request` and `endSession` until T4-05 adds `restoreSessions` and `sessionEnded`): `signIn`, `request` (no header, no absolute URL, a path resolved against the session's server URL, base path included, and refused with a dot segment, a backslash, a control character or a malformed escape; T3-16), `restoreSessions`, `endSession`, and `sessionEnded { session, reason }`. The player's launch request and the image view name a session by id and ask the registry for the client; neither sees the header. On Android the header is built in Kotlin; the core's header builder (`jellyfin/authorization-header.ts`) serves the reference transport (`adapters/fetch-transport.ts`) used by Node tests and the tripwire.
- **The engine is a port.** `PlayerEngine` (`packages/core/src/domain/player-engine.ts`, re-exported by `domain/playback.ts`) is the engine-neutral seam between the core and any player (T2-05): no surface geometry, fullscreen, volume or mute command; a launch request that is a discriminated union of an original file and an HLS session with token-free URLs and the opaque session id, built and re-checked by `player/launch-request.ts`; a typed capability list (`probe: "complete"` or `"failed"`) read by `domain/player-capabilities.ts`; a fixed method list (initialize, launch, pause, seek, select track, stop, and the one event subscription); and errors as typed codes.
- **One authenticated client.** Every server request (sign-in, catalog, artwork, media, playlists, segments, subtitles) goes through one OkHttp client. Its interceptor adds the header only for the signed-in server's scheme, host and port, and refuses a session's call outside its base path (T3-16); redirects and SSL redirects are off; no proxy; any other origin is refused before the request is sent. Built in `modules/session` (`OctaveHttp`, T3-03); sign-in, the pre-sign-in routes, catalog calls and logout go through it since T3-05 (`signIn`, `request`, `endSession`; decision 0005's T3-05 amendment), media since T8-02 (Media3's OkHttp data source over `OctaveHttp.callFactory(session)`, the dex check's one D4 exception), and artwork since T3-11 (`ArtworkFetch` in the session's HTTP package sends each image request with `OctaveHttp.newCall` under the session's authority; `modules/artwork` holds the view and the loader and no HTTP library; decision 0005's T3-11 amendment). A build check fails on Media3's default data sources, another `OkHttpClient`, `HttpURLConnection`, an ExoPlayer without Octave's media source factory, or a reach into React Native's or Expo's clients: `pnpm lint:network` on the source, `NetworkPathsBytecodeTest` on the compiled classes, and ESLint on the app's JavaScript (T3-04).
- **The video is native.** A native view hosts the video; React passes it no URL. The player's controls are React Native views over that view, so the module's surface does not grow for them; what only native code can do, such as keeping the screen on while the picture plays, crosses from the engine to the view inside Kotlin ([decision 0003](docs/decisions/0003-tv-and-mobile-shell.md), amendment of 2026-11-26).

### Engines

| | Media3 (first, T8) | libmpv (second, T13) |
|---|---|---|
| Plays | Original files the device's decoders handle, and every converted (HLS) session | Original files only, for what Media3 cannot decode on this device |
| Never plays | n/a | HLS. Android needs no playlist proxy and no loopback server |
| Network | Octave's data source over the one OkHttp client | Must pass every item of `docs/mpv-options-checklist.md` before it ships |
| HDR, Dolby Vision, passthrough | Device-dependent, through SurfaceView and `AudioCapabilities` | No native HDR output on Android today (decision 0003, Finding 1) |

- **Engine choice is per source and per device.** The device reports what it can play as a typed capability list (T2-05, T8-07). The source decision direct-plays only what an engine on this device can play (T2-07). When none can, the core asks the server for a conversion (below). T13-01 sets when mpv is chosen, and the player says which engine is playing.
- **Level, frame rate and channel limits (T8-23).** The capability answer that `initialize` returns has three optional limits: `maxLevel` and `maxFrameRate` on a video decoder (level in Jellyfin's `MediaStream.Level` scale: h264 ten times the level, hevc `general_level_idc`, av1 `seq_level_idx`; only those three codecs state one), and `maxAudioChannels` per audio codec on the complete answer. `readCapabilities` drops a decoder or an audio codec whose limit is present and invalid, so a bad limit narrows the list. No device reports them yet: the Kotlin probe does not fill them (backlog), so on a device these rules decide nothing until it does. The port's methods and events are unchanged.
- **HLS on Android.** Media3 reads playlists only through Octave's parser hook, which refuses the whole playlist unless every URI is same-origin and credential-free and passes the shared vectors (T8-08). Segments and keys are fetched through the one client, and a segment redirect is not followed.

---

## 3. Jellyfin API usage

### Supported servers

- **Jellyfin 10.11.x and 12.x**, and **Jellyscale**, which speaks the Jellyfin client API and is a first-class server. Jellyscale requires a token on every media request, so every media, playlist, segment, subtitle and image request carries the header. Where Jellyscale lacks a feature, the task waits for its issue; a token in a URL is never the workaround.
- Gate on parsed semver (`>= 10.11.0`) plus **feature detection** (`HasSegments`, presence of `Trickplay`), not exact-version regexes.
- 12.x turns off legacy authorization by default. The `api_key` query parameter, the `X-Emby-*` headers, and the `Emby` scheme are ignored unless an admin re-enables them. Checked on the 12.4.0 fixture: `GET /Users/Me?api_key=` returns 401, but `?ApiKey=` (capital K) and the `Authorization` header both return 200.
- The static stream and subtitle routes are anonymous on Jellyfin 10.11.7 and 12.4.0 (`VideosController.GetVideoStream` and `SubtitleController.GetSubtitle` carry no `[Authorize]`, v12.4 at 83d0d0e, lines 314 and 208). Jellyscale is not anonymous there. Header auth for media is therefore required, not only a way of keeping tokens out of URLs.

### Authentication and identity

| Concern | Approach |
|---|---|
| Header | `Authorization: MediaBrowser Client="Octave", Device="…", DeviceId="…", Version="…", Token="…"`. Values are quoted and URL-encoded. The core builds it for the reference transport (T2-04); Kotlin builds it on Android. `Device` is `Octave <platform>` and `Version` is the `package.json` version; the composition root passes both in. |
| Media requests | **Header auth, never query auth.** The native client's interceptor adds the header (T3-03). The token never enters JavaScript and never appears in a URL, prop, event, or log (decision 0005). |
| DeviceId | The server keeps **one token per DeviceId**. Persist a random install ID (not secret) and derive `DeviceId = SHA-256(installId:serverId:username)`. The login request carries the DeviceId before the user id exists, so the lowercased username stands in for the user id. Never generate a new one per launch. The device must derive the same value Node derives (T3-02). On Android the install id is one file in `getNoBackupFilesDir()`, kept by `modules/install-id` and read through `apps/tv/src/host/install-id.ts`; the app builds every gateway with `createGatewayFactory` in `apps/tv/src/host/gateway.ts`, which passes it, and a lint rule fails any other construction (T4-09). A storage failure rejects; it never falls back to a random id. |
| Quick Connect | 1. `GET /QuickConnect/Enabled`. 2. `POST /QuickConnect/Initiate` (GET was removed in 12.0) returns `{Secret, Code}`. 3. Show the code and a QR code and poll `GET /QuickConnect/Connect?secret=` until `Authenticated`. 4. `POST /Users/AuthenticateWithQuickConnect` `{Secret}`. This is the TV's main sign-in, and the only one for an account that has no password (SSO). Jellyscale support: issues #104 and #118 (T10-06). |
| Password login | `POST /Users/AuthenticateByName` `{Username, Pw}` returns `AccessToken`, `User`, `ServerId`. The fallback (T4-04). |
| Validate a stored token | `GET /Users/Me`. On 401, return to sign-in with the server and user already chosen. |
| Logout | `POST /Sessions/Logout` (revokes the token on the server), then delete the local credential, even when the revoke fails. |
| Token storage | Native memory, plus one encrypted record per session written and read only by Kotlin: AES-256-GCM under an Android Keystore key, in the no-backup directory (T4-05, decision 0005). Users stay signed in by default. A record is removed on sign-out, on a confirmed 401 (a 401 followed by a 401 from `GET /Users/Me`, which also emits `sessionEnded` with `revoked`), and when it cannot be read (`store-unreadable`). Development builds sign in only to development servers: loopback, `10.0.2.2` or a build-time allowlist, enforced by the session module (T3-33). |
| Discovery | Probe a URL with `GET /System/Info/Public` (no auth; returns `Id`, `ServerName`, `Version`). LAN discovery (T4-01) broadcasts `who is JellyfinServer?` to UDP 7359 on IPv4; replies are `{Address, Id, Name, EndpointAddress}` (`AutoDiscoveryHost.cs` and `ServerDiscoveryInfo.cs`, identical at v10.11.7 and v12.4; the server listens on `IPAddress.Any`, so there is no IPv6 discovery). Every reply is untrusted. Key saved servers by `Id`, not URL. A reply whose `Address` fails the host-class rule of decision 0001 is counted as refused and never probed. Choosing a listed address runs the same probe and confirmation as a typed one, and is refused unless the probe reports the discovered `Id`. A limited broadcast does not cross subnets. |

### Catalog (10.9+ paths; old `/Users/{userId}/…` routes are obsolete)

| Need | Endpoint |
|---|---|
| Libraries | `GET /UserViews` (filter by `CollectionType`) |
| Browse / search | `GET /Items?parentId=&includeItemTypes=&recursive=true&sortBy=&sortOrder=&startIndex=&limit=&fields=&searchTerm=&enableImageTypes=Primary,Backdrop,Thumb,Logo&imageTypeLimit=1&enableTotalRecordCount=false` (`true` on the first library page only) |
| Letter rail | `nameLessThan` counts per letter (T6-04) **[unverified]**; Jellyscale issue #227 (T10-09) |
| Remembered sort | `/DisplayPreferences` per library and account (T6-03) **[unverified]** |
| Continue watching | `GET /UserItems/Resume?mediaTypes=Video&limit=20&enableUserData=true`; Home sends `limit=20`, and the device ages a title out by `UserData.LastPlayedDate` and the Clock port, hiding nothing on the server (T5-07 D3, D7) |
| Next Up (merged into Continue watching) | `GET /Shows/NextUp?limit=20&enableRewatching=false&enableResumable=false&fields=PrimaryImageAspectRatio,DateCreated` with no `nextUpDateCutoff` (`docs/research/discovery-api.md` §3); the window is applied in `packages/core/src/domain/up-next.ts`. Series form: `GET /Shows/NextUp?seriesId=&limit=1&enableUserData=true&enableResumable=true&enableRewatching=false&enableImages=false&enableTotalRecordCount=false` |
| Recently played (dates next episodes, anchors the hero) | `GET /Items?recursive=true&includeItemTypes=Movie,Episode&filters=IsPlayed&sortBy=DatePlayed&sortOrder=Descending&limit=100&enableUserData=true&enableImages=false&enableTotalRecordCount=false` |
| Recently added (one Home row, movies and shows, episodes grouped by series) | `GET /Items/Latest?userId=&limit=15&groupItems=true&includeItemTypes=Movie,Episode&enableUserData=true&fields=PrimaryImageAspectRatio&imageTypeLimit=1&enableImageTypes=Primary,Backdrop,Thumb,Logo`, no `parentId` (`gateway.latestItems`; returns an array, not a QueryResult). Recorded on Jellyfin 10.11.7 and 12.4.0 (T5-02, `home-latest.json`): one list across both libraries, the show once as a series. A loose episode that names its series shows as the series; one that does not (Jellyscale today, issue #234, T10-07) is left out |
| Series | `GET /Shows/{id}/Seasons`, `GET /Shows/{id}/Episodes?seasonId=` |
| Next episode | `GET /Shows/{id}/Episodes?adjacentTo={episodeId}` |
| Detail | `GET /Items/{id}?userId=` with no `fields`; recordings on 10.11.7 and 12.4.0 (`item-detail-no-fields-*.json`) show the full item, including `MediaSources`, `MediaStreams`, `People`, `CommunityRating`, `CriticRating`, `Genres`, and `UserData` |
| Account settings | `GET` and `POST /DisplayPreferences/octave?userId=&client=octave`: Octave's own display preferences record, one `octave.*` string per setting in `CustomPrefs`, read fresh before every save and saved one at a time as a body built from allowlisted values (T9-09) |
| Account languages | `GET /Users/Me` → `Configuration`; save with `POST /Users/Configuration` carrying the whole `Configuration` as read and only the changed fields, no `userId`, one save at a time |
| Language codes | `GET /Localization/Cultures` |
| Type-ahead | `GET /Search/Hints`, on every letter (T6-06) |
| Filters | `GET /Items/Filters2?parentId=`, `filters=IsUnplayed,IsResumable,IsFavorite` |
| Played / favorite | `POST`/`DELETE /UserPlayedItems/{id}`, `POST`/`DELETE /UserFavoriteItems/{id}` |
| Images | `GET /Items/{id}/Images/{type}?tag=&maxWidth=&quality=&format=Webp`, through the native client with the header (T3-11). Tagged URLs are immutable, so cache by `(id, type, tag, size)`. Request at the drawn size; a poster on the 1920 canvas is never requested wider than 400 px. While the picture loads, the card shows its `ImageBlurHashes[type][tag]` preview: the image view takes the hash string as its sixth prop and decodes it natively, off the main thread, with no request (T3-39). |

Performance rules:

- Request only the `fields` a view renders.
- `ProductionYear` and `RunTimeTicks` are always returned and are not valid `fields` values.
- Set `enableTotalRecordCount=false` unless paging needs counts.
- Set `enableUserData` only where watched or progress state is shown.

### Playback negotiation (the core)

Policy: [decision 0002](docs/decisions/0002-server-transcoding-fallback.md) with its 2026-11-20 amendment. Play the original file whenever an engine on this device can; otherwise let the server remux or transcode over HLS, show it, and authenticate every request with the header.

```text
GET  /Items/{id}                                              → versions, chapters, trickplay
POST /Items/{id}/PlaybackInfo                                 → MediaSources[] evaluated for THIS device
     body:  UserId, StartTimeTicks, MediaSourceId?, MaxStreamingBitrate: <the viewer's local or remote limit>,
            AudioStreamIndex?, SubtitleStreamIndex? (a viewer's audio pick, and renegotiation; also in the query),
            EnableDirectPlay:true, EnableDirectStream:true, EnableTranscoding:true,
            AllowVideoStreamCopy:true, AllowAudioStreamCopy:true, AutoOpenLiveStream:false,
            AlwaysBurnInSubtitleWhenTranscoding:false, DeviceProfile: OCTAVE_PROFILE
     query: the same flags and MaxStreamingBitrate, duplicated (AlwaysBurnInSubtitleWhenTranscoding is body-only)
decide   DirectPlay   → GET /Videos/{id}/stream?Static=true&MediaSourceId=&PlaySessionId=   (header auth)
         DirectStream → GET /videos/{id}/master.m3u8?… rebuilt from TranscodingUrl, credentials stripped,
         Transcode      EnableTrickplay=false                                               (header auth on every playlist and segment)
         Refuse       → typed RefusalReason
```

**Always send a DeviceProfile.** The server applies `EnableDirectPlay`, user policy, the remote bitrate limit, and `ForceRemoteSourceTranscoding` only inside `SetDeviceSpecificData`, which runs **only when a profile is present**. That is also the only place subtitle `DeliveryMethod`/`DeliveryUrl` get filled in.

The profile accepts everything for direct play, so a codec never makes the server convert, and offers one HLS target per media type for fallback:

- `DirectPlayProfiles`: `[{ "Type": "Video" }, { "Type": "Audio" }]` (match-all).
- `TranscodingProfiles`: Video, `Protocol: "hls"`, `Context: "Streaming"`, `Container: "mp4"` (fMP4, so HEVC and AV1 can be stream-copied), `VideoCodec` with the encode target first (`h264,hevc,av1,vp9`), `AudioCodec` (`aac,ac3,eac3,opus,flac,mp3`), `EnableSubtitlesInManifest: false`; Audio, `Protocol: "hls"`, `Container: "mp4"`, `AudioCodec: "aac"`.
- `CodecProfiles`, `ContainerProfiles`: empty.
- `SubtitleProfiles`: `External` and `Embed` for `srt`, `ass`, `ssa`, `vtt`, `sub`, `pgssub` (External) and `srt`, `ass`, `ssa`, `pgssub`, `dvdsub`, `vtt` (Embed). Never `Hls`: HLS subtitle renditions carry `ApiKey={token}` in the playlist (`DynamicHlsHelper.cs` v10.11.7 line 615).
- `MaxStreamingBitrate`: the viewer's limit; `MaxStaticBitrate`: 1 Gbps.

What the device can decode is never written into the profile. It is a client-side capability list that the source decision reads (below).

**Source decision.** `decideSource` (`packages/core/src/jellyfin/source-acceptance.ts`) returns `DirectPlay`, `DirectStream`, `Transcode`, or `Refuse`. Rules run in order and the first that decides wins:

1. `Id` missing: Refuse `missing-source-data`.
2. `RequiresOpening` is `true` (a live source): Refuse `live-source`.
3. **DirectPlay** when all hold: `SupportsDirectPlay === true`; `Protocol === "File"`; `Path` present; `VideoType` is not `BluRay`, `Dvd`, or `Iso` (any case) and `Path` has no `BDMV` or `VIDEO_TS` segment and does not end in `.iso`; `TranscodingUrl` is empty; and an engine on this device can play the source's video and audio (`devicePlayability`, `packages/core/src/domain/device-capabilities.ts`; the host states "full" when it has no device limit). It reads the first video stream's codec, profile, bit depth, size, level and frame rate, and the judged audio stream's codec and channel count (the track the request names, else the source's default, else the first; tracks beside it are not judged, `docs/specs/T8-23.md`). A missing `Level` is not judged (the pinned Jellyscale states none); a missing frame rate or channel count is not playable when the device states that limit.
4. A disc folder or ISO that the server offered for direct play: send a second PlaybackInfo for that `MediaSourceId` with `EnableDirectPlay: false`, then apply the rules to the answer once. If the answer still offers direct play, Refuse `disc-source` or `iso-source`; there is never a third request.
5. **Device cannot play (T2-07).** The server offered direct play, but no engine on this device can play the source: send one more PlaybackInfo for that `MediaSourceId` with `EnableDirectPlay: false` and `AllowVideoStreamCopy: false`, in body and query, and `AllowAudioStreamCopy: false` too when the judged audio is what the device cannot play (the profile's `AudioCodec` list lets the server copy audio the device has no decoder for). Every other flag, the stream indices and the DeviceProfile are as on the first request. Use its answer, with a client-side conversion reason, only when its rebuilt URL carries `AllowVideoStreamCopy=false` (and `AllowAudioStreamCopy=false` when turned off). Otherwise Refuse `device-cannot-play`: a conversion without those parameters, direct play offered again, or nothing offered. An answer with nothing offered and `SupportsTranscoding: false` is `conversion-not-allowed`. The forced request is sent once per negotiation.
6. **DirectStream** or **Transcode** when `TranscodingUrl` is present, `TranscodingSubProtocol` is `hls` (otherwise Refuse `unsafe-transcoding-url`), and the rebuilt URL passes the HLS URL rules below. DirectStream only when the URL shows that video and audio are copied: `TranscodeReasons` is present and every value is `ContainerNotSupported` or `VideoCodecTagNotSupported`; no `SubtitleMethod=Encode`, `AlwaysBurnInSubtitleWhenTranscoding=true`, `RequireAvc=true`, or `AllowVideoStreamCopy`/`AllowAudioStreamCopy=false`; the source has one video stream whose codec is in the URL's `VideoCodec` list and within its limits; and the URL's `AudioCodec` is exactly the codec of the chosen audio stream. Anything else is Transcode. After the first frame of a converted session the coordinator asks the server (`GET /Sessions?deviceId=`) at 3 s and once more at 10 s; the plan becomes DirectStream exactly when `TranscodingInfo.IsVideoDirect` and (with audio) `IsAudioDirect` are true. Playstate reports for every converted session keep `PlayMethod: Transcode` (see Playstate reporting).
7. Otherwise Refuse: `conversion-not-allowed`, `not-a-file`, `missing-source-data`, or `no-sources`.

**Conversion answers are judged (T8-23).** Every conversion the negotiation would use (a first or plain answer, a disc's fallback answer, and the answer to the forced request) is judged against the device by `judgeConversion` (`packages/core/src/jellyfin/conversion-device-check.ts`) before a plan is built. The encode target is the first codec of the rebuilt URL's `VideoCodec` and `AudioCodec` lists (recorded on Jellyfin 10.11.7, 12.4.0 and the pinned Jellyscale: H.264 and AAC), with the source's size (scaled into the URL's size limits with its aspect ratio kept) and frame rate lowered by the URL's limits; its profile, bit depth, level and channel count are not judged. A copy is possible only when its `AllowVideoStreamCopy`/`AllowAudioStreamCopy` is not `false` and the URL's list holds the source stream's codec; Jellyscale's `VideoCodec=copy` is a video copy with no video target. A source with no probed streams (a Blu-ray folder) needs a decoder for every listed codec. On `"full"` nothing is judged. With a complete list: a target the device cannot decode, for a stream whose copy is not both possible and playable, is Refuse `device-cannot-play` ("conversion target not playable") with no further request; else a possible copy it cannot play sends the rule 5 forced request (on the forced answer, Refuse `device-cannot-play`, "copied stream not playable"); else the conversion is used. Under a failed probe targets are not judged and a possible copy counts as not playable. The judgement runs after the version is picked, so a version whose conversion the device cannot decode is not passed over for another (backlog).

**A viewer's audio pick.** A title's page can start a play with an audio track the viewer picked. The index goes in body and query with `MediaSourceId` in the body. A pick never costs a direct play: if the answer to the request that named the index does not direct play, one more request is sent without it, and a direct-play answer to either wins. When the device cannot play the video, the plain request is skipped and the forced conversion carries the pick. When only the picked audio cannot play, the plain request is sent: a direct-play answer wins and the original plays with the source's default audio; otherwise the forced conversion carries the pick. A refused first answer and a plain answer that needs the conversion also end in the forced request with the pick. At most four PlaybackInfo requests are sent (the first, the plain request, a disc's fallback, and the forced conversion, which is sent at most once); a session with a pick and no disc sends at most three. A session with no pick sends exactly the requests it did before. Fixtures `conversion-multitrack-audio-pick*` cover both servers.

With several versions, the first DirectPlay source wins, then the first DirectStream, then the first Transcode, then the first source that needs the forced conversion, then the first disc that needs the forced fallback, then the first refusal. A requested `MediaSourceId` is never replaced by another version. Refusals are typed (`RefusalReason` in `packages/core/src/domain/playback.ts`).

**HLS URL rules.** A `TranscodingUrl` is never used as given, logged, or shown (`packages/core/src/jellyfin/hls-url.ts`). Playback Negotiation resolves it against the normalized server URL (including any base path) and refuses it unless the path is `/videos/{itemId}/master.m3u8` or `/audio/{itemId}/master.m3u8` (any case) for the requested item, on the server's origin, with a host written in plain ASCII, with no user info, with exactly one `MediaSourceId` naming the chosen source, and with any `PlaySessionId` equal to the PlaybackInfo answer's. A query name with whitespace or a control character is refused. It removes every credential parameter (`ApiKey`, `api_key`, `access_token`, `Token`, `X-Emby-Token`, `ApiToken`, `AccessToken`; any case, also percent-encoded), sets `EnableTrickplay=false` exactly once (the server defaults it to `true` and then lists trickplay playlists with `ApiKey={token}`, `DynamicHlsController.cs` v10.11.7 line 464), removes `EnableSubtitlesInManifest=false` and refuses any other value, and refuses any `SubtitleMethod` other than `Encode`, `Embed`, `External`, or `Drop`. Every native validator re-checks the result with the same rules: the plans the negotiation builds from the recorded fixtures are the shared vectors in `packages/core/tests/fixtures/hls-master-urls.json` (written and checked by `packages/core/src/jellyfin/hls-master-url-vectors.test.ts`), and the Kotlin check must pass them (T8-08). `/Audio/{id}/universal` is never used, because it can redirect.

**Playlist validation.** Before the player reads a playlist, a native validator (Media3's parser hook on Android, T8-08) refuses the whole playlist unless every URI line and `URI=` attribute (stream, i-frame, media, map, key, session key, image) resolves to HTTP(S) on the server's origin with no user info, no fragment, and no credential parameter, and unless the body contains no credential parameter name and not the token value itself, as written or after up to three rounds of percent decoding (fail closed). A live playlist (no `EXT-X-ENDLIST`), `EXT-X-DEFINE`, a subtitle rendition, and trickplay are refused. The rules are language-neutral vectors in `packages/core/tests/fixtures/hls-playlists.json` (described in `packages/core/tests/fixtures/README.md`). A failure is the `unsafe-transcoding-url` refusal.

**Track changes on a converted session.** Choosing a track the conversion lacks, or changing burned-in subtitles, renegotiates at the current position with `AudioStreamIndex` and `SubtitleStreamIndex` (`-1` for off) in body and query and the playing `MediaSourceId` in the body (`MediaInfoHelper.cs` v10.11.7 lines 206-211, v12.4 lines 218-223). The old session is stopped and reported Stopped with `Failed: true` so the server leaves the play state alone, and its encode is deleted before the new negotiation (`PlaybackCoordinator.renegotiate`). Direct play switches tracks in the engine only.

**Indicator.** A DirectStream or Transcode plan carries its method and the server's `TranscodeReasons` (read from the URL). The player shows "Converting on server: {reason}" or "Repackaging on server, original quality: {reason}" (`packages/core/src/domain/conversion-copy.ts`), and the info sheet shows the method. A client-side conversion (rule 5) always shows "Converting on server: this device cannot play the original", whatever method the session later confirms, and the info sheet lists that reason first and leaves out `DirectPlayError`.

**Subtitles and track mapping.**

- External subtitle `DeliveryUrl` arrives as `/Videos/{id}/{msId}/Subtitles/{idx}/0/Stream.{fmt}?ApiKey=…`. Strip every query credential, validate same-origin, and fetch it with the header through the native client.
- While converting, HLS segments cannot carry subtitles (`IsSubtitleEmbedSupported`, `StreamBuilder.cs` v10.11.7 line 1522), so the server offers text subtitles as `External`. Graphical subtitles it cannot extract are burned in (`Encode`), and the indicator says so.
- Subtitles are drawn on the device, styled ones included (T8-11).
- **Jellyfin numbers external streams first.** Embedded streams have `Index = containerIndex + externalCount`. Each engine maps its own track ids to Jellyfin indices and verifies each candidate by type, language and codec family; anything unclear stays unmapped.
- Apply `DefaultAudioStreamIndex` and `DefaultSubtitleStreamIndex` for the initial selection. The server derives both from the account's language settings when PlaybackInfo carries `UserId`, which the gateway always sends; the client adds no preference logic. An absent or -1 default subtitle means subtitles off.

### Playstate reporting

| Event | Call |
|---|---|
| First frame | `POST /Sessions/Playing` |
| Every 10 s, and on pause/seek/track change | `POST /Sessions/Playing/Progress` |
| End / stop / error | `POST /Sessions/Playing/Stopped`, with **`Failed: true` on the error path** |

- The start is reported at the first frame, not when the engine has loaded, so a viewing left before its first frame sends no report (T8-03). A progress report carries the position of the latest snapshot; the engine's one-second `state` events (cause `property`) keep it current, and they send no report of their own.
- Report bodies carry `ItemId`, `MediaSourceId`, `PlaySessionId`, `PositionTicks`, `IsPaused`, `IsMuted`, `VolumeLevel`, `AudioStreamIndex`, `SubtitleStreamIndex`, `CanSeek`, and `PlayMethod`: `DirectPlay` for the original file and `Transcode` for every converted session, including one the server confirmed as DirectStream (`reportedPlan`, `packages/core/src/player/confirm-play-method.ts`). Reporting DirectStream would make the server clear `TranscodingInfo` while ffmpeg runs.
- Ticks are 10,000,000 per second.
- The server kills an HLS job 60 s after its last ping. Every start and progress report pings the session's jobs, so 10 s progress reports, which continue while paused, keep a paused conversion alive.
- **Stopping conversions.** The stopped report kills the session's jobs. Octave also calls `DELETE /Videos/ActiveEncodings?deviceId=&playSessionId=` before a new play session for the same item and when a stopped report fails, times out, or was never sent. `PlaystateReporter` sends it at most once per play session, bounded at 3 s.

### Realtime and remote control (later)

- **Socket.** `wss://host/socket` (`ws://` only where decision 0001 allows `http://`) with header auth, so it is opened natively and never with a token in the URL. Answer `ForceKeepAlive` with `KeepAlive` at half the interval. The `RealtimeConnection` port is `packages/core/src/domain/realtime.ts`; there is no TV adapter yet.
- **Cast target** (T12-06). `POST /Sessions/Capabilities/Full` with `PlayableMediaTypes: ["Video"]`, `SupportsMediaControl: true`, a `SupportedCommands` list, and the DeviceProfile.
- **Remote `Play`.** Always routed through the same negotiation. Never play a server-supplied URL directly.

### Newer server features

| Feature | Since | Use |
|---|---|---|
| Trickplay | 10.9 | `fields=Trickplay` gives tile metadata. Tiles: `GET /Videos/{id}/Trickplay/{width}/{index}.jpg?mediaSourceId=`, with the header (T8-16; Jellyscale #105) |
| Media segments | 10.10 | `GET /MediaSegments/{id}?includeSegmentTypes=Intro&includeSegmentTypes=Outro`. Precheck `HasSegments` (T8-14; Jellyscale #103) |
| Chapters | n/a | `fields=Chapters` |
| SyncPlay | n/a | Deferred (T12-08) |

### Call sequences

- **First launch:** discover or enter a URL, then `GET /System/Info/Public` and check the version; sign in with Quick Connect (code and QR) or password; store the credential (T4-05); `POST /Sessions/Capabilities/Full`.
- **Relaunch:** load the credential, then `GET /Users/Me`. On 401, sign in again.
- **Home:** in parallel, `/UserItems/Resume`, `/Shows/NextUp`, the recently-played list, and one `/Items/Latest` for the Recently added row; then `GET /Items/{heroId}` for the hero's overview and quality facts, and `GET /Shows/NextUp?seriesId=` when the hero is a series (T5-03).
- **Play:** item detail; PlaybackInfo with the profile; accept a source or show a refusal; launch the engine with a token-free typed request; report start on first frame, then progress.
- **Stop:** report stopped (with `Failed` on error); once the viewing has ended, whether or not that report arrived (the viewing waits for its reports only up to their deadlines, and a player that did not stop sends none), Home reads that one item and patches every shown card with its id through `withViewedProgress` (`packages/core/src/domain/home-refresh.ts`), told by the viewing's `afterViewing`. The rows are not loaded again, and no card moves, joins or leaves; a failed read leaves the cards as they were. A series card is not patched after one of its episodes is played.
- **Logout:** `POST /Sessions/Logout`, then delete the credential.

### Transport

The core uses no HTTP client and no Jellyfin SDK. The gateway reaches the server through the injected `Transport` port (`packages/core/src/ports/transport.ts`): `signIn`, `request` and `endSession`. `adapters/fetch-transport.ts` is the reference implementation for Node tests and the tripwire; it is the only place that calls `fetch` and sets `redirect: "manual"`. The gateway remains the **only** module that talks to the server.

---

## 4. Invariants

Each invariant names what enforces it today, or the task that adds the enforcement. The desktop app's native tests proved the same rules for libmpv; their names and what each proved are in `docs/mpv-options-checklist.md`.

| # | Invariant | Enforced by |
|---|---|---|
| I1 | Octave plays the original file whenever the server offers direct play, the source passes the direct-play rules, and an engine on this device can play it. It never asks the server to convert such a source, and never converts silently: every DirectStream or Transcode is shown with its reason. When no engine on the device can play a source, the one extra request sends direct play and stream copy off. The rule and the tripwire are per device ([decision 0002](docs/decisions/0002-server-transcoding-fallback.md), amended 2026-11-20) | Today: the capability-aware decision and the forced conversion (`device-capabilities.test.ts`, `source-acceptance-device.test.ts`, `device-conversion-negotiation.test.ts`, `device-negotiation-unchanged.test.ts`), the judgement of every conversion answer and the device's level, frame-rate and channel limits (T8-23: `conversion-device-check.test.ts`, `conversion-device-negotiation.test.ts`, `conversion-device-requests.test.ts`, `device-limits.test.ts`), the source decision fixture tests (`packages/core/src/jellyfin/conversion-negotiation.test.ts`, `conversion-fixtures.test.ts`), flags in body *and* query (`gateway.test.ts`), the profile without codec conditions (`device-profile.test.ts`), and the server tripwire `pnpm test:tripwire` (`tests/integration/tripwire.ts`: per server, Jellyfin 10.11, 12.4 and Jellyscale, and per capability set, T2-09). The device's own list: the probe's vectors (`packages/core/tests/fixtures/device-capability-probes.json`, `CapabilityMapTest`, `device-capability-probes.test.ts`), the app's composition (`scripts/tv-device-capabilities.test.ts`) and the emulator wire test `player-capabilities` against Jellyfin 12.4 and Jellyscale (T8-07). Per device: T8-20 (on devices) |
| I2 | Only two URL shapes reach a player: a `Static=true` original-file URL, or a same-origin `master.m3u8` URL rebuilt by Playback Negotiation with no credential and `EnableTrickplay=false`. Every URI inside an HLS playlist is same-origin and credential-free, checked natively before the player reads it | Today: `launch-request-hardening.test.ts` (the core's launch seam), `hls-url.test.ts` and the shared vectors (`hls-master-url-vectors.test.ts` writes and checks `packages/core/tests/fixtures/hls-master-urls.json`; `hls-master-url-device-vectors.test.ts` does the same for `hls-master-urls-device-conversion.json`, the forced-conversion plans). Native: the Kotlin re-check and playlist validator against `hls-master-urls.json`, `hls-master-urls-device-conversion.json` and `hls-playlists.json` (T8-08) |
| I3 | No generic player bridge: the player module exposes only the `PlayerEngine` port's fixed methods, with typed requests and typed error codes | Today: `packages/core/src/domain/player-engine-allowlist.test.ts`; the module (T8-01): `scripts/tv-module-surfaces.test.ts` holds its Kotlin definition, `modules/player/surface-allowlist.json` and its `docs/security.md` line together, `ModuleSurfaceTest` holds the definition, and `LaunchRequestReaderTest` the typed launch |
| I4 | Tokens never appear in a URL, React prop, event, log, error, or diagnostic; media, playlists, segments, subtitles, and images authenticate with the header | Today: `packages/core/src/redact.test.ts`, `redact-canary.test.ts`, `error-strip.test.ts`, and the gateway's credential-query tests. Native today: `modules/session` (T3-03) refuses a URL holding the token, logs nothing, redacts the header's debug form, and hands back no header in an answer. T3-05: the transport strips the token from every answer (`TokenStripTest`); the wire tests show no token in any URL on the wire against the pinned servers (`transport-probe-then-signed-in`), and no canary across the seam or in logcat (`transport-canary`, `judgeLogcat`). T3-11: the image view takes only a session id, item id, image type, tag and width (and, since T3-39, the image's BlurHash string, which is not a credential and is checked for the canary by `artwork-canary`), and every image request carries the header with no token in its URL (`ArtworkFetchTest`, `scripts/tv-artwork-module.test.ts`; on a device `artwork-header-and-cache` and `artwork-canary`, gate: ci). Native next: T8-08 (playlist bodies), T10-02 (canary through a whole journey) |
| I5 | Servers require HTTPS, except plain HTTP to loopback and, after a one-time per-server confirmation, to private-LAN hosts classified by the literal host ([decision 0001](docs/decisions/0001-private-lan-http.md)). No request follows a redirect, uses a proxy, or reaches an origin other than the signed-in server's; credentials in URLs are refused | Today: one host classifier (`classifyServerAddress` in `packages/core/src/domain/host-class.ts`, which also checks the address as written) tested against `packages/core/tests/fixtures/host-classes.json` and run by the conformance suite (`packages/core/src/conformance/url-conformance.ts`); gateway normalization refuses public HTTP before any request and refuses sign-in until the confirmation; redirects and status 0 are errors (`gateway-redirects.test.ts`). Native today: `modules/session` (T3-03) has the one OkHttp client and a Kotlin classifier that passes `host-classes.json`, with MockWebServer tests against a second origin. Android cleartext (T3-15): one app-wide `base-config` declared by `modules/session` (`octave_network_security_config.xml`), checked on the release APK by `pnpm tv:apk:check`, with `CleartextProbe` under `pnpm tv:e2e` proving private-LAN and loopback HTTP pass and every public vector is refused; the classifier is the only gate that accepts a host. Resolved addresses (T3-20): the one client's `ResolvedAddressRule` refuses a plain-HTTP name whose answer holds no loopback or private-LAN address, and dials only passing addresses (`ResolvedAddressTest`, `ResolvedAddressAnswerTest`, `ResolvedAddressScopeTest`; the probe's `resolved-address` check under `pnpm tv:e2e`). Native next: T3-04 (build check) |
| I6 | Subtitle URLs are same-origin and validated before they are authenticated | Today: the gateway's subtitle validation tests (`gateway.test.ts`, `subtitle-url-host.test.ts`) and `launch-request-hardening.test.ts`. Native: T8-10, T8-11 |
| I7 | No player or image path that cannot send the header is ever used, as a fallback or otherwise (a web video element, Media3's default data sources) | T3-04 (`pnpm lint:network` K1, K2, K3, K6, K9, and K4 on `MediaPlayer`, `VideoView`, Coil, Glide and Picasso; ESLint T3, T5; `NetworkPathsBytecodeTest`, whose K4 by type also refuses `MediaExtractor` and `MediaMetadataRetriever`, T3-29), T8-02 (the first engine: `scripts/tv-player-media3.test.ts` holds that it builds no default data source or media source factory and draws only on the view's `SurfaceView`; the wire test `player-original-file` plays through the one client), T3-11 (server artwork only through the native artwork view and the one client; a failed image shows the card's title, never another loader: `ArtworkModuleSourceTest`, `apps/tv/src/host/native-artwork.test.tsx`). The rules are name lists; a player or loader they do not name is caught only in review |
| I8 | Only the gateway talks to the server; only the engine port talks to the player | `pnpm lint:boundaries` (dependency-cruiser; rules in `DOMAINS.md`); T3-04 for headers or tokens passed outside the transport adapter (ESLint T1, T2, T4, T7 in `apps/tv`); on the release APK, `scripts/tv-apk-dex.mjs` in `pnpm tv:apk:check` (T3-19) fails when Octave's code holds a network sink outside the one client or references a listed entry point |
| I9 | No engine loads user configuration, scripts, or plugins, or follows a reference inside downloaded content; its safety options are fixed in code from typed values | Media3: its only network path is Octave's data source (T3-04: `pnpm lint:network` K1 to K6 refuse its default HTTP, UDP, RTSP and RTMP paths and every other HTTP stack, and `NetworkPathsBytecodeTest` by type, on compiled Media3 1.11.1 calls since T8-02; T8-02's engine fixes its media source factory, data source and load policy in code, `scripts/tv-player-media3.test.ts`). libmpv: every item of `docs/mpv-options-checklist.md` as a test (T13-02) |

---

## 5. Known gaps

| Severity | Gap | Task |
|---|---|---|
| High | The token lived in the reference transport's memory; decision 0005 moves it into Kotlin and leaves the core a session id. Done on Android in T3-05: the app's transport is the session module, so the token is held only in Kotlin; the reference transport remains for Node tests and the tripwire | T3-03, T3-05 (done) |
| Medium | No native validator exists yet; the vectors are proven only against the TypeScript rebuild and the desktop validator at the tag | T8-08 |

---

## Sources

- Jellyfin OpenAPI specs 10.10.7, 10.11.11, 12.4 — https://api.jellyfin.org/openapi/stable/
- Jellyfin server source at `v10.11.11` / `v12.4`: `AuthorizationContext.cs`, `MediaInfoController.cs`, `MediaInfoHelper.cs`, `VideosController.cs`, `StreamInfo.cs`, `SessionManager.cs`, `AutoDiscoveryHost.cs`
- Jellyfin server source at `v10.11.7` / `v12.4` for decision 0002: `DynamicHlsController.cs`, `DynamicHlsHelper.cs`, `DynamicHlsPlaylistGenerator.cs`, `HlsSegmentController.cs`, `PlaystateController.cs`, `TranscodeManager.cs`, `StreamBuilder.cs`, `UniversalAudioController.cs`
- Jellyfin 12.0 release notes — https://github.com/jellyfin/jellyfin/releases/tag/v12.0
- Media3 HDR playback — https://developer.android.com/media/grow/hdr-playback
- Decisions 0003 and 0004 for the shell, engine, and device evidence
