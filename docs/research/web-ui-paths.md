# Octave's web UI: React Strict DOM, React Native Web or React DOM

2026-11-26. Sources were read that day. "Source" means RSD `main` or the 0.0.55 tarball. Nothing was built or run.

**Recommendation: plain React DOM (`apps/web`) on `packages/core`, with shared tokens. Don't adopt RSD now.**

Links: [repo](https://github.com/react/react-strict-dom) · [npm](https://registry.npmjs.org/react-strict-dom) · [docs](https://facebook.github.io/react-strict-dom/) · [HTML table](https://facebook.github.io/react-strict-dom/api/html/) · [CSS table](https://facebook.github.io/react-strict-dom/api/css/)

## 1. RSD status
- Latest is **0.0.55, 2026-01-09** ([npm](https://registry.npmjs.org/react-strict-dom)). It is the only release in the last 12 months. Before it, 0.0.36–0.0.54 came out from June to October 2025.
- Not archived; pushed 2026-11-16; now `react/react-strict-dom` ([API](https://api.github.com/repos/facebook/react-strict-dom)). There are 22 commits since 10 Jan: Feb 1, Apr 2, May 10, Jun 4, Aug 1, Nov 4 ([commits](https://github.com/react/react-strict-dom/commits/main)). The creator's latest commit there is the 0.0.55 one ([by author](https://github.com/react/react-strict-dom/commits?author=necolas)). Their current role is unverified.
- The published package lags. It pins StyleX `^0.15.4`; `main` has `^0.18.3`; current is 0.19.2 ([npm](https://registry.npmjs.org/@stylexjs/stylex), 2026-11-12). `main`'s fixes, including native `ref.focus()`, are unreleased ([changelog](https://github.com/react/react-strict-dom/blob/main/packages/react-strict-dom/CHANGELOG.md)).
- Stability: the version is 0.0.x. The docs say "under development. Not all capabilities are available on native" ([intro](https://facebook.github.io/react-strict-dom/learn)). The creator said "I think it's production ready" ([2024-04-01](https://github.com/necolas/react-native-web/discussions/2646)).
- Production: Meta's docs say Meta uses it. The creator names the Facebook and Instagram VR apps ([2025-11-24](https://nicolasgallagher.com/one-react-for-web-and-native/)). Production use outside Meta: **unverified**.
- Maintenance rule: **passes narrowly** (active, not superseded). Release maturity is the risk.
- T16-01's text ("0.0.54, last release 2025-10") is stale.

## 2. How it works
- **Web:** production Babel output flattens to React DOM elements, with StyleX CSS and a small style merger ([how web works](https://facebook.github.io/react-strict-dom/contribute/how-web-works)). The web entry imports no React Native (source).
- **Native:** it maps to RN View, Text, TextInput, Pressable and Image, with JavaScript polyfills for CSS; transitions use `Animated` ([how native works](https://facebook.github.io/react-strict-dom/contribute/how-native-works)).
- **Build:** a Babel preset plus its PostCSS plugin. Metro/Expo is the documented route ([setup](https://facebook.github.io/react-strict-dom/learn/setup)). Vite 8 needs `vite-plugin-babel` ([Vite](https://facebook.github.io/react-strict-dom/learn/setup-vite)). The repo's Expo web example also installs `react-native-web` ([package](https://github.com/react/react-strict-dom/blob/main/apps/expo-app/package.json)).
- **Floor:** published peers are React 19 and RN ≥0.79.5; unreleased `main` needs **≥0.85**. The Expo guide asks for the latest SDK and the New Architecture.
- **SDK 58 / RN 0.88 / tvOS fork:** **unverified**. The repo's examples use RN 0.83.6 and [Expo's example](https://github.com/expo/examples/tree/master/with-react-strict-dom) uses SDK 57 / RN 0.86. A third party lists 0.0.55 with RN 0.88.0-rc.1 ([Reanimated](https://github.com/software-mansion/react-native-reanimated/blob/main/apps/web-example/package.json)), which doesn't prove it runs. The tarball's two deep imports (`ViewNativeComponent`, `TextAncestor`) exist as files in the installed `react-native-tvos@0.88.1-0`. I found no TV code in the source and no tvOS issue.

## 3. Coverage for Octave

| Need | Web | Native |
|---|---|---|
| Elements | No `video`, `canvas`, `svg` or `dialog` export (source) | Same; no grid or inline layout |
| Events | DOM | Source maps click, focus, blur and pointer events, though the table marks click/focus/blur ❌ (not web-conformant). `onKeyDown` is wired only for text inputs; `onKeyUp` ❌ |
| Focus | DOM refs; `tabIndex` 0/-1. `:focus-visible` through StyleX is expected, not tested | `tabIndex` only sets `focusable`; `autoFocus` ❌; only `:focus`; `focus()` takes no options |
| D-pad | You write roving focus | **No TVFocusGuideView, `hasTVPreferredFocus`, `nextFocus*` or TV events** |
| Grid, flex, media | All listed CSS is supported | Flex; some media queries; **no grid**, `calc`, `clamp` or sticky |
| Container queries, hover | StyleX/CSS; container queries through RSD untested | Container queries: unverified (the matcher is for media queries); hover polyfilled |
| Scrolling, lists | DOM; virtualisation is yours | No ScrollView or list in its RN imports; `scrollTo`/`scrollIntoView` ❌. Keep FlashList |
| Animation | CSS | Transitions polyfilled; no CSS animations |
| Images | `<img>` | Mapped to RN Image, which cannot replace Octave's artwork view |
| Video/MSE | Raw `<video>` in a `.web.tsx` (ordinary React DOM) | n/a |
| Android player and artwork views | n/a | Plain RN components, or `compat.native`, which is **"experimental and unstable"** ([compat](https://facebook.github.io/react-strict-dom/api/other/compat/)) |

On TV, `compat.native` or raw RN could carry the focus props, but that is exactly the code that would stop being shared.

## 4. Migration cost
Counts are from `octave` main `bca52cb6`, excluding tests, test support, `e2e` and `host`.
- `design`, `shell`, `home`, `player`, `sign-in`, `signed-in`, `first-screen`: **83 TS/TSX files, 5,395 lines**.
- Of these, **45 files (3,686 lines)** directly import RN, Reanimated, FlashList or React Navigation.
- By a name search over production source, **28 files (2,634 lines)** mention TV focus, Back or remote APIs (includes comments).
- Tests and test support in these folders, except `first-screen`: 8,475 lines. `packages/core` source without tests: 9,612 lines, reusable by every path.

**Sharing screens means moving TV to RSD too.** That rewrites most of those 45 files, retests focus, and keeps TV-specific code for focus, lists, the player and artwork.

**Web-only RSD** is React DOM plus StyleX, with fewer elements, a restricted style API and a 0.0.x dependency. It buys web-first components that a *later* native screen might reuse, plus strict types. It shares nothing with today's TV UI. The creator also says exporting existing RN apps to web gives poor results, from Meta's attempt ([2024](https://github.com/necolas/react-native-web/discussions/2646)). RSD does not run existing RN code on web either.

## 5. Comparison (ratings are my judgement)

| | RSD | RNW 0.21.x | React DOM |
|---|---|---|---|
| Maintenance risk | High: one release in 12 months, 0.0.x | Medium | Low: `react-dom` 19.3.1, 2026-10-14 |
| Web quality, a11y, hover | Good, but elements missing | RN semantics; extra work | Best: full platform |
| Bundle | Docs claim <2 kB RSD runtime on web; StyleX extra; unmeasured | ~76 kB gzip full package (repo research, unverified here) | No UI abstraction |
| TV regression risk | High if shared; none web-only | Medium: web variants touch shared files | None from UI (shared core and token edits still apply) |
| Shared UI | None until TV is rewritten | Highest if the export works | Core and tokens only |
| First screen | Setup plus new UI | Fixes first: the tree would crash on web (local research §4) | Fastest predictable start; UI built again |
| Phone and desktop | Best theory; unproven native | Phones reuse RN anyway; desktop uses web | Phones reuse the RN app; desktop can reuse `apps/web` |

The crash finding comes from `docs/research/web-client.md` §4; I did not retest it.

**RNW has changed.** The 2024 statement was: no investment at Meta, and new projects should use RSD (reaffirmed May 2025). But `zoontek` published [0.21.3 (09-25) and 0.21.4 (10-08)](https://github.com/necolas/react-native-web/releases), a 0.22 canary appeared 11-20 ([npm](https://registry.npmjs.org/react-native-web)), and `master` is busy this month ([commits](https://github.com/necolas/react-native-web/commits/master)). I found no handover statement. T16-01's reason for rejecting RNW needs the owner to revisit it; it doesn't make RNW the better choice.

**Styling:** CSS Modules with CSS custom properties generated from the TypeScript tokens. Vite builds them in (8.4.0, 2026-11-26, [npm](https://registry.npmjs.org/vite)), they give the full CSS platform, and they need no Babel step. StyleX alone is a sound, maintained option (0.19.2; [repo](https://github.com/meta/stylex), pushed 11-25), but its main gain here, easing a move to RSD, is speculative. Share token values, not the TV's 1920×1080 sizes: plan 017 gives web its own type ramp and layout.

No other candidate is needed. Tamagui and similar kits don't solve TV focus, and I did not run maintenance checks on them as candidates.

## 6. Decisive spike (1–2 days, throwaway worktree)
Web-only RSD cannot justify itself, so test **sharing with TV**. Write hero, two card rows, a rail opened with Left, one artwork view and a player placeholder **once** in RSD. Build with published 0.0.55 on SDK 58: tvOS fork (release build on the Shield) and web. Do TV first and stop at the first hard failure.

| # | Pass threshold | Hard? |
|---|---|---|
| 1 | Both targets build and run with no patches, fork or unreleased commit | yes |
| 2 | 500 D-pad presses, single and held: 0 wrong, missing or stuck moves; ring, rail return and Back restore match DESIGN §9 | yes |
| 3 | ≥70% of the slice's non-test UI lines are shared; `react-native`, `compat` and platform files are confined to ≤3 primitive adapters | yes |
| 4 | Against the same slice in current RN: key-to-focus p95, janky frames and memory each no more than 10% worse over three runs | yes |
| 5 | Web at 1920, 1280 and 390 px: keyboard-only pass, `:focus-visible`, hover, a container query and a raw `<video>` with MSE | yes |
| 6 | Web gzip JavaScript is within 15 kB of a plain React DOM build of the web slice | no |

All hard gates pass: choose RSD only if the owner also accepts migrating TV and the 0.0.x risk. Any fails: **plain React DOM**; don't try a hybrid. Plan 017's media falsifier stays first. Its RNW export falsifier is no longer needed if this recommendation is accepted.

## Recommendation
**Build plain React DOM on `packages/core`, with shared token values and CSS Modules.** RSD is actively developed but not ready to carry Octave's TV UI: its native layer lacks the TV focus, key and list support the app relies on. On web alone it adds limits and little value. The cost is real: Octave writes its web screens separately and keeps them in step through the core, tokens and `DESIGN.md`. This changes plan 017's one-tree RNW decision and needs the owner's call.

**What would change my mind:** a new tagged RSD release with current StyleX and a stated RN 0.88 floor or support, plus a passing spike (above all gates 2 to 4). Documented TV focus support would add weight. A firm plan for new phone screens that are also web screens would justify retesting.

**Three least-sure facts**
1. How 0.0.55 behaves on SDK 58 with `react-native-tvos` 0.88: I checked only source and file paths. My TV focus, scrolling and key gaps are also from source, not a device.
2. How widely RSD is used in production, outside Meta especially. The evidence is Meta's and the creator's own claims.
3. RNW's long-term ownership: `zoontek`'s releases are visible, but I found no formal handover or roadmap.
