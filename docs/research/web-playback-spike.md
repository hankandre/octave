# Web playback spike: 4K fMP4 HLS through hls.js with the header (plan 017, milestone 0 (b))

Date: 2026-11-26. A throwaway falsifier. Its code isn't in this repository. This page is the record.

## The question

Can a browser play a Jellyscale fMP4 HLS copy at 4K-remux bitrates through hls.js 1.7.4, with a loader that adds `Authorization` and no token in any URL? What is the highest bitrate each browser plays without a stall, and how does the buffer quota behave?

## Short answer

- **The mechanism works in Chrome and Firefox.** Across 33 measured runs there were 1,513 playlist and segment requests (48.6 GB). Every one carried the header, none had a token in its URL, and none came from the media element. Jellyscale copied every film (58 of 58 PlaybackInfo decisions were `method=copy`, and 16 of 16 jobs were `copy=true`) and re-encoded none.
- **Firefox 159 (Linux) played every bitrate tested in real time.** That covers H.264 up to 112 Mbps and HEVC up to 121 Mbps, each for 180 s plus a seek, with no stall and no dropped frame (one `bufferStalledError` at 112 Mbps H.264, below). 121 Mbps is the highest bitrate tested, not a ceiling that was found.
- **Chrome 157 (Linux) could not decode 4K H.264 in real time on this machine at any bitrate tested.** Its clock ran at 0.97× the film's speed at 17 Mbps, falling to 0.62× at 112 Mbps. Meanwhile 4.6 to 27 s of video stayed buffered, it fired no `waiting` event and it reported no dropped frame. Headed Chrome measured the same, so this is software decode on this machine, not headless mode and not the buffer. It doesn't measure Chrome where it has a hardware decoder (Windows, macOS). The Chrome figure is therefore **not yet measured on a representative machine**.
- **The quota was always recovered and never reached the viewer.** Chrome threw `QuotaExceededError` at 92 Mbps and above, even with a byte budget. With hls.js defaults, both browsers threw it from 55 Mbps. In every case hls.js 1.7.4 evicted back buffer, raised non-fatal `bufferFullError`, lowered `maxMaxBufferLength` (to 4.7 s at 112 Mbps) and kept playing, with no stall from it.
- **Safari, iPhone and iPad weren't run.** The kit for them is below.

## Method

- **Server.** A disposable Jellyscale at `origin/main` `d9b44a5868ec`, built from an exported tree (`--roles=all`, Postgres 18, its own Compose project with a port Docker picked, on loopback). Its ffmpeg is 8.1.3. From 22:23Z it was capped at 4 CPUs and 4 GB (Postgres at 1 CPU and 1 GB). A copy costs 0.05 cores, so the cap did not limit it.
- **Media.** Synthetic only: `testsrc2` with strong temporal noise at 3840×2160, 23.976 fps, encoded with ffmpeg 9.0.2. H.264 was x264 `veryfast`, High@5.1, with near-constant bitrate. HEVC was x265 `ultrafast`, Main@5.1. Both had a keyframe every 48 frames (2.0 s, measured), no scene cuts and stereo AAC at 192 kbps, in Matroska with Cues. A 24 s encode was looped by stream copy to 300 s, so each film repeats its 24 s 12.5 times. That is enough to fill and cycle every buffer several times.
  - The rates below are measured from the files themselves (container bitrate, size × 8 ÷ duration).
    - H.264: 17.4, 37.0, 55.4, 73.4, 91.5 and 112.3 Mbps.
    - HEVC: 20.3, 40.4, 60.6, 80.6, 101.0 and 121.4 Mbps.
  - The peak one-second video rate was 140.7 Mbps for H.264 and 132.7 Mbps for HEVC, both at the 120 Mbps target.
- **Copy, not re-encode.** The DeviceProfile direct-plays only `mp4`, and its fMP4 HLS transcoding profile lists `h264,hevc` and AAC. `MaxStreamingBitrate` is 400 Mbps in both the body and the query. Jellyscale logged `playback decision method=copy reasons=ContainerNotSupported … out_height=2160` and `transcode started … copy=true` for every play. Segments were cut on the 2 s keyframes into 4.0 s segments.
- **Client.** hls.js 1.7.4, exact version, run from its `hls.min.js` build.
  - A loader subclass strips `ApiKey` and `api_key` from every URL before the request.
  - `xhrSetup` refuses another origin, opens the cleaned URL and sets `Authorization: MediaBrowser …, Token="…"`.
  - The token stays only in page memory.
  - `SourceBuffer.prototype.appendBuffer` is wrapped to count every `QuotaExceededError`, before hls.js sees it.
- **Same origin.** A small Node proxy serves the page at `/spike/` and passes everything else to Jellyscale. It records each request's path with token values redacted, whether the header was present, whether a token was in the URL, `Sec-Fetch-Dest`, the status and the bytes. It can also throttle the whole link.
  - Playwright also recorded each request's resource type and header in the browser.
  - `Sec-Fetch-Dest` was `empty` on every request (XHR or fetch).
  - The resource types were only `fetch` and `xhr`, never `media`.
- **Browsers.** Playwright 1.65.1.
  - Google Chrome 157.0.8103.38 (`channel: 'chrome'`, headless, with one headed check).
  - Firefox 159.0 (Playwright build 1572, headless).
  - Machine: Linux, a 16-thread desktop CPU, 61 GB of RAM, an NVIDIA GPU (VA-API not set up) and a desktop session on the display.
- **Each run.** Sign in, PlaybackInfo, load the master playlist, play muted for 180 s, then seek 30 s past the end of the buffer and play 10 s more. Then report Stopped.
  - Stalls are counted twice.
    - From `waiting` and `playing` events, with the buffer ahead at each event.
    - From a once-a-second check: a second in which the clock moved less than 0.5 s while not paused counts as "frozen".
  - `realtimeRatio` is media seconds played divided by wall seconds since the first frame. It is the measure that caught Chrome.
  - Buffered bytes are estimated from the latest load of each segment that overlaps `video.buffered`, so they are approximate.
- **Buffer settings.** Two configurations were run.
  - "Budget": `maxBufferLength` 8 s, `maxBufferSize` 80 MB and `backBufferLength` 4 s. hls.js's `maxBufferLength` is a floor, `max(8 × maxBufferSize / bitrate, maxBufferLength)`, so it has to be small for a byte budget to hold.
  - "Defaults": hls.js 1.7.4's own settings, which are 30 s, 60 MB and an unbounded back buffer.

## Results

`rt` is media seconds per wall second. "Ahead" is the least buffer ahead seen after the start. The start is from `loadSource` to the first `playing` event. A cold start, with the server's copy job not yet running, is in the next section.

### Unthrottled, budget configuration

| Browser | Film (measured) | rt | Stalls (events) / frozen s | Dropped | Quota errors | hls.js errors | Max buffered | Least ahead | Segment (median) | Unbuffered seek: seeked / playing |
|---|---|---|---|---|---|---|---|---|---|---|
| Chrome | H.264 17.4 | 0.971 | 0 / 0 | 0/4448 | 0 | seek-over-hole 1 | 75 MiB, 36 s | 27.2 s | 8.4 MiB | 0.70 / 1.49 s |
| Chrome | H.264 37.0 | 0.906 | 0 / 0 | 0/4147 | 0 | same | 150 MiB, 34 s | 14.8 s | 17.6 MiB | 1.05 / 1.83 s |
| Chrome | H.264 55.4 | 0.800 | 0 / 0 | 0/3656 | 0 | same | 144 MiB, 22 s | 10.3 s | 26.6 MiB | 1.70 / 2.49 s |
| Chrome | H.264 73.4 | 0.754 | 0 / 0 | 0/3458 | 0 | same | 140 MiB, 16 s | 8.0 s | 35.1 MiB | 1.82 / 2.88 s |
| Chrome | H.264 91.5 | 0.685 | 0 / 0 | 0/3138 | 8 | `bufferFullError` 7 | 131 MiB, 12 s | 4.6 s | 43.9 MiB | 1.89 / 2.94 s |
| Chrome | H.264 112.3 | 0.616 | 0 / 1 | 0/2828 | 7 | `bufferFullError` 7 | 136 MiB, 10 s | 4.6 s | 53.6 MiB | 2.30 / 3.62 s |
| Firefox | H.264 17.4 | 1.000 | 0 / 0 | 0/4567 | 0 | seek-over-hole 1 | 75 MiB, 36 s | 27.4 s | 8.4 MiB | 0.28 / 1.10 s |
| Firefox | H.264 37.0 | 1.000 | 0 / 0 | 0/4566 | 0 | none | 106 MiB, 24 s | 15.0 s | 17.6 MiB | 0.38 / 1.20 s |
| Firefox | H.264 55.4 | 1.000 | 0 / 0 | 0/4563 | 0 | seek-over-hole 1 | 132 MiB, 20 s | 10.7 s | 26.7 MiB | 0.52 / 1.09 s |
| Firefox | H.264 73.4 | 1.000 | 0 / 0 | 0/4569 | 0 | same | 140 MiB, 16 s | 7.9 s | 35.1 MiB | 0.61 / 1.43 s |
| Firefox | H.264 91.5 | 0.999 | 0 / 0 | 0/4566 | 0 | same | 154 MiB, 14 s | 6.9 s | 43.4 MiB | 0.73 / 1.55 s |
| Firefox | H.264 112.3 | 0.999 | 0 / 0 | 0/4569 | 0 | seek-over-hole 1, `bufferStalledError` 1 | 184 MiB, 14 s | 0 s | 54.4 MiB | 2.34 / 3.50 s |
| Firefox | HEVC 20.3 | 1.000 | 0 / 0 | 0/4567 | 0 | seek-over-hole 1 | 87 MiB, 36 s | 24.5 s | 9.7 MiB | 0.33 / 1.16 s |
| Firefox | HEVC 40.4 | 1.000 | 0 / 0 | 0/4568 | 0 | same | 135 MiB, 28 s | 13.7 s | 19.3 MiB | 0.45 / 1.29 s |
| Firefox | HEVC 60.6 | 1.000 | 0 / 0 | 0/4564 | 0 | same | 145 MiB, 20 s | 9.6 s | 28.7 MiB | 0.62 / 1.19 s |
| Firefox | HEVC 80.6 | 1.000 | 0 / 0 | 0/4565 | 0 | same | 134 MiB, 14 s | 7.8 s | 38.6 MiB | 0.71 / 1.27 s |
| Firefox | HEVC 101.0 | 1.000 | 0 / 0 | 0/4567 | 0 | same | 167 MiB, 14 s | 7.8 s | 47.9 MiB | 0.88 / 1.44 s |
| Firefox | HEVC 121.4 | 1.000 | 0 / 0 | 0/4565 | 0 | same | 201 MiB, 14 s | 7.8 s | 58.4 MiB | 0.89 / 1.45 s |

Notes on the table:

- **Chrome and HEVC.** Chrome on this machine answers `isTypeSupported` "no" for `hvc1` and `hev1`, so it was not run on HEVC.
- **"Seek-over-hole".** hls.js's non-fatal `bufferSeekOverHole` came once at the start of almost every run. It is hls.js stepping over the gap before the first sample.
- **Firefox at 112 Mbps H.264.** It reported one `bufferStalledError` and a least-ahead of 0. Its clock still ran at 0.999 with no frozen second, so the stall, if any, was shorter than the one-second check.
- **Firefox's buffered estimate.** Firefox held an estimated 184 to 201 MiB at 112 to 121 Mbps without a quota error. The estimate counts audio and video and is approximate, and Firefox's quota was not measured directly here.

### hls.js defaults

| Browser | Film | rt | Stalls / frozen s | Quota errors | Recovery |
|---|---|---|---|---|---|
| Chrome | H.264 55.4 | 0.831 | 0 / 0 | 6 | `bufferFullError` 6, `maxMaxBufferLength` lowered to 14.7 s |
| Chrome | H.264 112.3 | 0.612 | 0 / 7 (6.2 s ahead) | 7 | `bufferFullError` 7, lowered to 4.7 s |
| Firefox | H.264 55.4 | 1.000 | 0 / 0 | 5 | `bufferFullError` 5, lowered to 18.75 s |
| Firefox | H.264 112.3 | 0.999 | 0 / 0 | 7 | `bufferFullError` 7, lowered to 5.0 s; 1 dropped frame |

The settings that mattered:

- **`backBufferLength`.** Its default is unbounded, and that is why the defaults hit the quota from 55 Mbps.
- **`maxBufferLength`.** It is a floor, so at 30 s it forces 30 s × bitrate. That is 420 MB at 112 Mbps.
- **`maxBufferSize`.** It is only a ceiling above that floor.

With the byte budget (8 s floor, 80 MB, 4 s back buffer), quota errors disappeared below 92 Mbps in Chrome and at every rate in Firefox. hls.js's own recovery handled the rest. No run needed a fatal-error path.

### Start time

- **Cold** (the server starts its copy job): 1.16 to 2.06 s. This comes from the first play of each film in the first runs, which were taken under contention (below).
  - Chrome H.264: 1.40, 1.55, 1.66, 1.78 and 2.06 s at 37 to 112 Mbps.
  - Firefox HEVC: 1.16, 1.31, 1.44, 1.48 and 1.52 s at 40 to 121 Mbps.
  - The kit's check on a fresh server: 1.31 s at 17 Mbps.
- **Warm** (segments already stored): 0.19 to 1.01 s, growing with the size of a segment.

### Throttled below the bitrate (the proxy limits the whole link)

| Browser | Film | Link | Start | rt | Stalls (events) | Stalled s | Unbuffered seek: seeked / playing |
|---|---|---|---|---|---|---|---|
| Chrome | H.264 55.4 | 45 Mbps | 5.38 s | 0.797 | 13 | 7.3 (+ decode) | 6.42 / 7.20 s |
| Firefox | H.264 55.4 | 45 Mbps | 5.14 s | 0.799 | 38 | 41.9 | 5.47 / 6.04 s |
| Chrome | H.264 112.3 | 100 Mbps | 5.50 s | 0.608 | 0 (decode-bound below the link) | 6 frozen s | 7.20 / 8.26 s |
| Firefox | H.264 112.3 | 100 Mbps | 5.13 s | 0.807 | 38 | 34.0 | 6.25 / 7.09 s |

- **The copy has one rendition, so hls.js has nothing to switch to.** On a link below the file's rate, playback runs at about link ÷ bitrate, with a stall every segment or two. Neither the header loader nor the buffer causes this. It is why negotiation needs a lower rendition, a viewer's cap or a re-encode, when the link is below the copy's rate.
- **The start figures are buffer-fill time.** At 45 to 100 Mbps a start takes about 5 s, because hls.js waits for the first segment of 27 to 54 MiB.

### Decode limit or buffer limit

- **Chrome is decode-limited.** The clock slowed with the bitrate while the buffer stayed full (least ahead 4.6 to 27 s, frozen seconds with 5.8 to 7.6 s ahead), and there was no network limit (median segment download 2.4 to 6.1 Gbps on loopback).
- **Headed Chrome is the same.** H.264 55.4 Mbps ran at rt 0.697 (load 13.8) and 112.3 Mbps at 0.610, both with 0 stalls and 0 drops reported.
- **Software decode is an inference.** No run used a hardware decoder, and none played the same files in Chrome without hls.js, so neither control rules out another cause. Read "decode-limited" above with that limit.
- **The result is this machine, not the browser.** It shows Chrome's software H.264 path on this Linux machine, partly under contention. It doesn't show what Chrome does with a hardware decoder. Firefox on the same machine decoded the same files in real time.
- **The slowdown is silent.** Chrome fired no `waiting` and reported no dropped frame while running at 0.62× real time. hls.js's stall detection and `getVideoPlaybackQuality` would both miss it.

## Contention and what affected the figures

- **Another session was working on the same machine** (Android emulator and Gradle builds).
- **The one-minute load at the start of each batch:**
  - Chrome H.264 budget: 12.2.
  - Firefox H.264: 1.7.
  - Firefox HEVC: 9.0.
  - The defaults runs: 3.9 and 2.0.
  - The throttled runs: 2.1 to 5.6.
  - Headed Chrome: 13.8.
- **Chrome's real-time ratios may be lower than on an idle machine.** Firefox's were 1.0 under the same contention.
- **The first batch is excluded from the tables.** At 21:35 to 21:56 UTC, Chrome H.264 and Firefox HEVC ran in parallel. That shared the proxy's log and the CPU, and the byte estimate then double-counted re-fetched segments. Its start times are used above only as the cold starts.
- **Every table above is from sequential runs:** 21:59 to 23:13 UTC, 23:20 to 23:33 UTC (throttled) and 23:33 to 23:40 UTC (headed, insecure context and the kit check).
- **Two broken throttled attempts were thrown away** (22:58 to 23:13 and 23:14 to 23:18 UTC). The proxy's throttle lost a `drain` event, so they never started.

## What is unverified

- **Chrome with hardware decode (Windows, macOS), Edge, Safari on macOS, iPhone and iPad.** None was run. Edge is Chromium but was not checked.
- **`ManagedMediaSource`** with `disableRemotePlayback = true` was not exercised: no browser here exposes it. hls.js 1.7.4 prefers it (`preferManagedMediaSource` is `true` by default) and sets `disableRemotePlayback` when it uses it. The page sets it as well.
- **Real film.** Noise at a fixed bitrate is a hard case for the entropy decoder, but real 4K remuxes differ in structure (B-pyramids, HDR, 10-bit HEVC). 10-bit HEVC, HDR and Dolby Vision were not tested.
- **Long keyframe intervals.** The test files had a keyframe every 2 s, so segments were 4 s. Jellyscale allows copy segments of up to 12 s. At 112 Mbps that is about 168 MB, more than Chrome's whole quota (~150 MiB). Whether hls.js can append such a segment in Chrome is untested, and it is the most likely way a copy could fail outright.
- **`MediaCapabilities.decodingInfo`** answers (`smooth`, `powerEfficient`) were not recorded, so whether they predict Chrome's slowdown is unknown.
- **Quotas.** They were inferred from the buffered estimates and the counted `QuotaExceededError`s, not measured directly.
- **Real networks.** The throttle is a token bucket on the whole proxy link, not a real network with latency or loss.

## Verdict against the gate

The gate: "if (b) fails in a v1 browser, that browser leaves v1 or the plan stops".

- **Nothing seen here fails the gate.** A 4K fMP4 HLS copy plays through hls.js with a header-injecting loader, with no token in any URL and no request from the media element. `QuotaExceededError` never reached playback in Chrome or Firefox.
- **Firefox passes**, in real time up to the highest bitrate tested, 121 Mbps, in both H.264 and HEVC.
- **Chrome passes the mechanism, but its bitrate ceiling is not measured on a representative machine.** On this Linux machine with software decode, no tested 4K bitrate played in real time (0.97× at 17 Mbps). That reflects this machine, not a fault in the path.
- **Safari and iPhone are not run.** Their gate is open until the owner's kit run.

So no bitrate ceiling can be written into milestone 1 for Chrome, Safari or iPhone from this spike. What the results do tell milestone 1 and milestone 4:

1. **Make the ceiling a per-device measurement, not a constant.** The same Chrome build ranged from 0.97× to 0.62× real time with its decoder alone. The engine needs a watchdog on clock progress (media seconds per wall second while not paused and with buffer ahead), not only `waiting` and dropped-frame counts, which stayed silent.
2. **A byte budget works with hls.js 1.7.4 if `maxBufferLength` is small.** The budget configuration was an 8 s floor, 80 MB and a 4 s back buffer. hls.js's quota eviction and `bufferFullError` recovery were enough on their own in every run.
3. **Keyframe interval is part of the ceiling.** Segment size is bitrate × segment length. A long-GOP source at a high bitrate can produce one segment larger than the whole quota, which is untested.
4. **A copy has no lower rendition.** Below the link rate, the engine has to renegotiate, by cap or by re-encode, or it will stall every segment.

## The Apple test kit (Safari on macOS, iPhone and iPad)

- **What it is.** One page, with hls.js 1.7.4 inlined when the server starts, served by a small Node proxy that is same-origin with the disposable Jellyscale.
- **What the page does.** It signs in, lists the 12 films and plays one or all of them with the same measurements. It uses `ManagedMediaSource` where `MediaSource` is missing and sets `disableRemotePlayback = true`. Its results block can be selected and copied with no console.
- **Plain HTTP.** In headless Chrome the page played correctly over plain HTTP on a non-loopback name (`isSecureContext === false`). The MSE specification marks neither `MediaSource` nor `ManagedMediaSource` `[SecureContext]`, and the page avoids secure-context-only APIs (it uses `crypto.getRandomValues`, not `randomUUID`, and no clipboard API).
- **Unverified.** Whether Safari opens `ManagedMediaSource` in an insecure context. The page's first results line prints `secure context` and `ManagedMediaSource`, so the owner's run will answer it. If it says `ManagedMediaSource: false` on an iPhone over HTTP, HTTPS is needed.
- **Where it runs.** The kit and the server run on the Linux machine the spike used, not on the Apple device.
- **By default the kit listens on that machine's loopback only.** A Mac can reach it by forwarding the port over SSH (`ssh -L 8099:127.0.0.1:8099 <that machine>`, then `http://127.0.0.1:8099/spike/`), which opens nothing to the network and is a secure context; whether that machine accepts SSH is unverified. A phone or tablet needs the LAN command in the spike's instructions, which serves plain HTTP on that machine's home-network address. That exposes the whole disposable Jellyscale API and the test page to the home network, unencrypted. The admin password and the token cross the network in clear text. The server holds only synthetic films and a random password. Stop it with Ctrl-C.
