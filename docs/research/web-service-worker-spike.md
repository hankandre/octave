# Web spike: a service worker that adds `Authorization` to `<video src>` (plan 017, milestone 0 (c))

Date: 2026-11-26. A throwaway experiment. Its code isn't in this repository; this page is the record. Every figure is from one Linux machine on loopback. It is not a platform claim.

## The question

Can a service worker add `Authorization` to the requests of a same-origin `<video src="/path">` playing a progressive MP4, with no token in any URL, in Chrome, Firefox (bug 1923096, with and without `crossorigin="anonymous"`) and Safari? What breaks?

## Short answer

- **The mechanism works in Chrome 157 and in Playwright's Firefox 159.** In a page the worker controlled, every video request passed through it and reached the server with the header. No URL carried a token.
- **Firefox did not need `crossorigin="anonymous"`.** Same-origin `<video src>` was intercepted with and without it. [Bug 1923096](https://bugzilla.mozilla.org/show_bug.cgi?id=1923096) is still open (UNCONFIRMED, last changed 2026-05-27), and its report loads the video from another port, which is another origin. This test doesn't cover that case.
- **Firefox breaks playback when it stops the worker.** A response streamed through the worker dies when Firefox ends the idle worker: `MediaError` code 1, and the element does not recover. With default timeouts and the link at 6,000 kbps (file about 4,200), a film died after 27.7 s. This is a blocker for the design as built.
- **Chrome survived it.** A forced stop did not cut an open stream. 150 s of continuous play and a seek after 90 s idle both worked.
- **When interception fails, the browser usually falls back to the network silently**, without the header. The server's 401 is what stops it. The token did not leak in any such case, because only the worker adds it.
- **Safari was not run.** A kit is ready.

## Method

- **Origin server.** A Node server written for this test. Media routes answer 401 without a valid `Authorization: MediaBrowser … Token="…"`, serve single ranges with 206 or 416, send `Cache-Control: no-store`, and can pace every response. Each request is logged with its range, status, session letter and **whether** a header was present, never the token. A control route serves the same file with no header, outside the worker's paths.
- **Media.** Synthetic only: `testsrc2` with temporal noise, 640×360, H.264 about 4 Mbps (about 4,200 kbps with AAC and container), 300 s, 157 MB. One copy has `moov` first and one has `moov` last (checked with `ffprobe`).
- **Worker.** It intercepts one path prefix. It rebuilds each request as `mode: 'same-origin'`, `credentials: 'omit'`, `redirect: 'error'`, copies `Range`, and adds the header. A copy of the original request in `no-cors` mode would not accept the header, so the rebuild is required. It holds one token per client in memory. After a restart it asks the requesting page by `MessageChannel`, waiting 3 s. With no token it **answers 401 itself** and sends nothing. It marks its requests with its instance id, so the server can tell them from direct ones.
- **Browsers.** Google Chrome 157.0.8103.38, headless. Firefox 159.0, Playwright build 1572, headless. That is a patched Nightly-branded build, **not release Firefox**. Playwright 1.65.0.
- **Two ways of driving.** Most runs used Playwright. In Firefox under Playwright, documents loaded by a later navigation or a new page lost interception, `fetch` and `<img>` included, although the registration was active. The same binary started with no driver on a fresh profile, with the page driving itself, kept control in `window.open`, `location.assign` and reload. **That failure is a driver artifact**, and the Playwright Firefox results for later documents (two tabs, reloads, unregister after reload) were thrown away. Firefox's single-page results below come from the first, claimed page under Playwright. Its navigation, two-session, reload, unregister and default-timeout results come from the driverless binary. Chrome's default-timeout run also had no driver or DevTools attached.
- **Forcing a worker stop.** Chrome: CDP `ServiceWorker.stopAllWorkers`. Firefox: `dom.serviceWorkers.idle_timeout` and `idle_extended_timeout` set to 2 s, then 9 s of waiting.

## Does the worker see every request?

In a controlled page, yes, for both browsers and both `crossorigin` variants, until a fault was induced.

| Seen by the worker | Destination | Mode without / with `crossorigin` | Client id | `Range` visible |
|---|---|---|---|---|
| Video | `video` | `no-cors` / `cors` | yes | yes |
| `<track>` | `track` | `same-origin` / `cors` | yes | none sent |
| Poster | `image` | `no-cors` / `cors` | yes | none sent |
| `<img>` added by script | `image` | `no-cors` | yes | none sent |

The server saw `Sec-Fetch-Dest: empty` on every request the worker made. **A server-side wire test can no longer tell that a media element started a request**, which plan 017's "zero requests initiated by a media element" relies on.

## Results

"Header" means the request reached the server with it. "Refused" means the worker answered 401 itself and nothing reached the server. The `crossorigin="anonymous"` variant of the single-page sequence matched the plain one in both browsers.

| Case | Chrome 157 | Firefox 159 (build 1572) | Safari |
|---|---|---|---|
| Ranges through the worker (`0-1`, middle, suffix, tail, past the end) | 206 ×4 with correct `Content-Range` and length; 416 | same | not run |
| First play | plays; header | plays; header | not run |
| Seek far ahead | one new range; header | same | not run |
| Seek back | one new range; header | played from cache, no request | not run |
| Pause 90 s, then play 15 s | plays | plays from buffer, no request | not run |
| `moov` at the end | plays (start, tail, then middle ranges), seeks | same | not run |
| Link at 3,000 kbps, 60 s | 42 s played, 8 stalls; **the control without the worker was identical** | **died at 30 s** (code 1) after 11.9 s played; the control played 37.6 s with no error | not run |
| Link at 6,000 kbps, 150 s, default worker timeouts | all 150 s played | **died after 27.7 s** (code 1); the worker's instance had changed | not run |
| Same, worker holding itself open with `waitUntil` on the piped body | not needed | **died after 87.7 s**: later, not fixed | not run |
| Unthrottled, 150 s, default timeouts | not run | played, one request (why it survived is unverified) | not run |
| Forced stop during an open throttled stream | stream survived 25 s more | **died** | not run |
| New instance asks the page, page answers | works, then seeks | works if no stream was open at the stop | not run |
| New instance, page refuses or never answers | refused; code 2, fatal for the element. It came **within 3 to 6 s of normal play**, at Chrome's next range request | refused at the next new range (a seek); code 2 | not run |
| Idle 90 s with no driver, then seek | worker had been replaced; asked the page; plays | not reached (already dead) | not run |
| Server revokes the token mid-film | the next 10 s still played; the next new range got 401; code 2. A new `src` at the same place with a new token played at once | same | not run |
| Sign-out mid-film | the next 10 s still played; the next new range refused | same | not run |
| Two sessions in two tabs | at once, with seeks, a worker stop and cleared tokens: no request carried the other tab's token. Signing out A left B playing. The same URL in both tabs gave one request each, with its own token | second tab started while the first was playing: its own token. Seeks, restart and sign-out with two tabs are **not measured** (driver artifact) | not run |
| First load, before the worker controls the page | **direct, no header**, 401, code 4. The element stays dead after the claim; a new `src` works | same | not run |
| Hard reload | page uncontrolled; **direct, no header**. `register()` and `ready` don't help | same (`location.reload(true)`) | not run |
| After a hard reload, worker calls `clients.claim()` | control returns; header | same | not run |
| Normal reload after that | controlled | controlled | not run |
| `unregister()` mid-film, then seek | still intercepted in that page | same | not run |
| Media URL opened as a page | refused (no client to ask); nothing sent | not measured (driver artifact) | not run |
| Picture-in-Picture, then seek | entered after a click; the new range had the header | same, through this build's script API | not run |
| AirPlay | not observable | not observable | **not run** |
| Fault: fetch handler throws before `respondWith` | **silent fallback: direct, no header**, 401, code 4 | same ("401: Unauthorized") | not run |
| Fault: `respondWith` rejects | no fallback; nothing sent; code 4 | same | not run |

### Requests with and without the header

Counted from the server's log. Runs spoiled by the driver artifact are left out.

- **Chrome, Playwright runs:** 106 requests, 99 with the header and 7 without. All 7 were induced or intended: 2 first loads, 2 after a hard reload, 2 handler faults and 1 control request. The driverless long run's requests all had it.
- **Firefox:** in the single-page, restart, long and first-load runs, the only requests without the header were the same kinds (first loads, handler faults, the control). In the driverless runs the only one was the video request after a hard reload.
- **No request left without the header from a controlled page in normal operation**, a restarted worker included.

## What breaks

1. **Firefox ends a worker that is still streaming.** The causal evidence: the control without the worker did not fail; the worker's instance changed; with 2 s timeouts the stream died at once; with defaults it died near 30 s; with `waitUntil` near 90 s. That Firefox's idle timers cause it is an inference from those four. A film lasts far longer than any of them, and the element does not resume by itself. The page would have to detect code 1 and set `src` again, again and again.
2. **One restart makes the page part of playback.** The token can only come back from a live page that answers in time. A busy, frozen or discarded page means a fatal element error. Chrome asks during ordinary play, not only after a seek. A background-tab freeze was not tested.
3. **Every start needs a guard.** A page that sets `src` before it is controlled gets a dead element. `navigator.serviceWorker.controller` catches first load and hard reload, but not a handler that throws.
4. **Revocation and sign-out take effect at the next request, not at once.** The server checks the header when a request starts, and the browser keeps what it already has. The page must clear `src` itself on sign-out.
5. **The error says nothing.** A bypass shows as code 4, "format not supported". A refusal or a 401 mid-film shows as code 2. The page learns of a 401 only because the worker tells it.

**Not tested, and the obvious next step if anyone returns to this:** the worker could answer each open-ended range with a short, bounded 206, so that no response outlives a worker timeout. Whether each browser, Safari included, accepts a shorter range than it asked for and requests the rest is unverified.

## Security note

**Where the token lives.** In page memory, and a second copy in the worker's memory, per tab. Nothing was written to storage, a cache or a URL. The page can't let go of it, because a restarted worker asks for it again. The alternative, persisting it for the worker, was not tried.

**Compared with plain page-memory `fetch`:**

- A script running in the page is already a loss in both designs ([decision 0005](../decisions/0005-token-boundary.md) governs only the native forms).
- **The worker adds a deputy.** It signs whatever the controlled page asks for under its prefix, so a script needs no access to the token. Here an `<img>` added by script got the header. By the same mechanism, injected HTML **without script** (`<img>`, `<video>`, `<track>`) should send authenticated GETs, which a header-adding `fetch` never allows. That exact case was not run.
- A real design would need: GET only; an exact media route pattern, not a prefix; a destination allowlist (this experiment signed images and plain `fetch` too); and the worker never returning the token or a response to anything else. A destination of `video` does not stop a script from reading frames of same-origin video.
- A script can also message the worker: clear a token, or give it another account's token for this tab. Any other application on the same origin (the plan keeps jellyfin-web reachable) can reach the registration too. That is reasoning, not a test.

**When interception fails.** In first load, hard reload and a throwing handler, the browser went to the network with no header and no warning. A rejected `respondWith` did not fall back. Secrecy held in every case, since the browser has no token of its own. It holds only because the server refused the request. **On a server whose media route answers without a header, a bypass would play and nobody would notice.** Which routes of which server do that was not checked. DevTools' "Bypass for network" also skips the worker (not run).

**Scope and updates.**

- Scope decides which pages are controlled. A controlled page's requests reach the worker whatever their path, so the worker's own match is the real limit.
- The worker outlives the page and the deploy. A bad version can break all playback, or send everything past itself, until browsers fetch a fix. It needs a tested kill switch, `updateViaCache: 'none'`, and no response caching.
- `skipWaiting` swaps workers mid-film: the new one has no tokens and may speak a different protocol from the open page. An update during playback was not run. In Firefox, assume it can also cut an open stream (not run).
- This design contradicts the plan's "Service worker: none" and decision 0006's promise bar ("Never present: a service worker").

## Unverified

- **Safari on macOS, iPhone and iPad:** everything. The Firefox bug's reporter says Safari intercepts `<video src>`; that is not a test. Safari's `bytes=0-1` probe, AirPlay (the receiver may fetch by itself, without the worker), worker suspension and Low Power Mode matter most.
- **Release Firefox**, and Firefox or Chrome on Windows, macOS and Android; headed windows; Edge.
- A cross-origin video, the case in bug 1923096.
- Picture-in-Picture started from the browser's own control, background-tab freezing, discarded tabs, a worker update mid-film, a back-forward cache restore.
- A real network, 4K bitrates, long films, and HTTPS in a browser (the kit's TLS mode was checked with `curl` only).
- **A real Jellyscale was not used.** The optional check needed a new server image, and free memory was short with other work on the machine. Nothing here shows that Jellyscale's static stream route behaves like the test server.

## Verdict

- **Chrome: it works**, with the guards above.
- **Firefox: interception works; playback does not hold up.** The browser's worker lifetime cuts streamed responses. No tested change fixed it.
- **Safari: unknown.**
- **Overall: not usable as built** for an "original file on the web" path. It would need a way to survive Firefox's worker lifetime, a passing Safari run, a narrower worker than this one, and an owner decision amending 0006.

**Against the gate:** (c) changes nothing in v1. This is a partial success in one browser, with one blocker and one browser not run. At most it justifies a backlog line: "after v1, original progressive MP4 through a service worker; first prove short bounded ranges survive Firefox's worker timeouts, and run Safari; the owner decides, since it amends 0006." This spike edits neither the plan nor the backlog.

## The Safari kit

It is self-contained (Node, no packages), with its own README, and sits in the owner's cache folder as `spike-c-octave-web/kit/`. The server runs on the Linux machine, not on the Apple device, and listens on loopback unless told otherwise.

- **Mac, nothing exposed:** forward the port over SSH and open the loopback address, which is a secure context. Whether that machine accepts SSH is unverified.
- **iPhone or iPad:** a service worker needs a secure context, so plain HTTP on the home network will not work. `make-certs.sh` makes a 30-day throwaway certificate and deletes the CA key; the device must install and trust the CA; the server is then started on the machine's home-network address. Whether iOS Safari registers a worker under such a certificate is unverified.
- **What that exposes** to the home network: the test page; the synthetic films, also without a header on the control route; a sign-in that gives a token to anyone; the request log (no tokens); and the throttle and revoke controls. Nothing else on disk is served.
- **Checked here** in headless Chrome by pressing the page's buttons over loopback HTTP: the automatic run, play, seek, claim, check and long play completed with no page error; first load was checked in a fresh tab. The two-tab, hard reload, Picture-in-Picture and AirPlay steps are manual and were not pressed as buttons. The kit's last edit, to the first-load button, was checked after the other runs.
