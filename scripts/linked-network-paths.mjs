// LINKED_NETWORK_PATHS (T3-04 items 6 and 7): every file of a library linked into the APK that can open a connection
// around the one client, with the reason it may stay and the rules that refuse it in Octave's code. The inventory in
// scripts/check-network-paths.mjs fails when a linked file opens a connection and is not here, or an entry's file no
// longer does. Each entry: { id, package, file, what, verdict, reason, refusedBy }. `package` is the name the app
// depends on; `file` is relative to the package folder. A new entry needs a reason a reviewer can check
// (docs/specs/T3-04.md, "Linked paths").
const ALLOWLISTED = "allowlisted";

const entries = (base, files) => files.map((file) => ({ ...base, file }));

export const LINKED_NETWORK_PATHS = [
  // --- what Expo links (item 6) ---
  ...entries(
    {
      id: "E1",
      package: "expo",
      what: "expo/fetch, which replaces the app's global fetch, over React Native's client",
      verdict: ALLOWLISTED,
      reason:
        "Part of expo, which the app needs to start. JavaScript holds no token (decision 0005), so it cannot send the header. The file-URL interceptor rewrites file: URLs and opens no connection of its own.",
      refusedBy: ["T1", "T4", "K7"],
    },
    ["android/src/main/java/expo/modules/fetch/ExpoFetchModule.kt", "android/src/main/java/expo/modules/fetch/OkHttpFileUrlInterceptor.kt"],
  ),
  // E2, expo-file-system, has no entry: apps/tv/package.json excludes it from autolinking (T3-19 item 3), and
  // ABSENT_PACKAGES in scripts/tv-apk-dex-lists.mjs fails the dex check if expo.modules.filesystem. comes back.
  ...entries(
    {
      id: "E3",
      package: "expo-asset",
      what: "expo-asset's download of a remote asset over React Native's client",
      verdict: ALLOWLISTED,
      reason: "A dependency of expo; the app loads bundled assets only, and no Octave code imports it.",
      refusedBy: ["T4", "K7"],
    },
    ["android/src/main/java/expo/modules/asset/ResourceAsset.kt"],
  ),
  // E4, @expo/log-box, has no entry: apps/tv/package.json excludes it from autolinking (T3-19 item 3), and
  // ABSENT_PACKAGES in scripts/tv-apk-dex-lists.mjs fails the dex check if expo.modules.logbox. comes back.
  // E5, @expo/dom-webview, has no entry: apps/tv/package.json excludes it from autolinking (T3-19 item 3), and
  // ABSENT_PACKAGES in scripts/tv-apk-dex-lists.mjs fails the dex check if expo.modules.webview. comes back.
  // E6, expo-modules-core's network-inspector interceptors, has no entry: their file constructs no client, and K8
  // refuses them on the one client.
  ...entries(
    {
      id: "E7",
      package: "expo-modules-core",
      what: "the module runtime's use of React Native's OkHttpClientProvider",
      verdict: ALLOWLISTED,
      reason: "The module runtime hands React Native's client to Expo modules that ask for one. Octave's module asks for none.",
      refusedBy: ["K7"],
    },
    ["android/src/main/java/expo/modules/kotlin/AppContext.kt"],
  ),
  ...entries(
    {
      id: "E8",
      package: "expo-modules-core",
      what: "the module runtime's java.net.URL argument converter",
      verdict: ALLOWLISTED,
      reason: "Parses a module argument into a java.net.URL and opens no connection. Octave's module takes no URL argument.",
      refusedBy: ["K5"],
    },
    ["android/src/main/java/expo/modules/kotlin/types/net/URLTypConverter.kt"],
  ),
  // --- React Native's own networking (item 7) ---
  ...entries(
    {
      id: "R1",
      package: "react-native",
      what: "JavaScript fetch and XMLHttpRequest (NetworkingModule), its client provider, and its read of a request body from a URL",
      verdict: ALLOWLISTED,
      reason:
        "React Native's own module, which Metro needs in a debug build. JavaScript holds no token, and the app sends nothing from JavaScript (T1). RequestBodyUtil's URL.openStream serves NetworkingModule's request bodies (NetworkingModule.kt calls RequestBodyUtil.getFileInputStream).",
      refusedBy: ["T1", "K7", "K5"],
    },
    [
      "ReactAndroid/src/main/java/com/facebook/react/modules/network/NetworkingModule.kt",
      "ReactAndroid/src/main/java/com/facebook/react/modules/network/OkHttpClientProvider.kt",
      "ReactAndroid/src/main/java/com/facebook/react/modules/network/RequestBodyUtil.kt",
    ],
  ),
  ...entries(
    {
      id: "R2",
      package: "react-native",
      what: "JavaScript WebSocket (WebSocketModule)",
      verdict: ALLOWLISTED,
      reason: "Metro's reload channel in a debug build. Octave's realtime socket is opened natively, with header auth, in a later task (ARCHITECTURE.md).",
      refusedBy: ["T1", "K7"],
    },
    ["ReactAndroid/src/main/java/com/facebook/react/modules/websocket/WebSocketModule.kt"],
  ),
  ...entries(
    {
      id: "R3",
      package: "react-native",
      what: "a network source on React Native's Image (FrescoModule)",
      verdict: ALLOWLISTED,
      reason: "Draws bundled assets. Server artwork goes through the native image view (T3-11).",
      refusedBy: ["T3", "K7"],
    },
    ["ReactAndroid/src/main/java/com/facebook/react/modules/fresco/FrescoModule.kt"],
  ),
  // R4, a call to OkHttpClientProvider, has no entry of its own: K7 refuses it in Octave's code with no exception, and
  // every linked caller is listed under E1, E3, E7, R1 to R3, R5 and W1.
  ...entries(
    {
      id: "R5",
      package: "react-native",
      what: "the dev-server inspector's client (DevSupportHttpClient)",
      verdict: ALLOWLISTED,
      reason:
        "Development tooling, tested, not removed (T3-19): it ships in the release dex because ReactHostImpl.loadNetworkResource, entered from C++, keeps it. The dex check (scripts/tv-apk-dex.mjs, rule D6) holds the classes that reference it to DEV_SUPPORT_CLIENT_CALLERS, four dev-support callers, and pnpm tv:smoke shows the release app opens no connection to the development server port while it starts. loadNetworkResource fetches whatever URL a connected debugger passes, a home-network address included. Tested (T3-28): scripts/tv-apk-native-inspector.mjs, a step of pnpm tv:apk:check, fails when a native library of the APK is wired to call the C++ inspector's network dispatcher (NetworkIOAgent::handleRequest), which only a library compiled with REACT_NATIVE_DEBUGGER_ENABLED is. Still read from source and not tested: that the dispatcher is the only C++ route to loadNetworkResource, and the run-time flag that decides whether an inspector target exists (fuseboxEnabledRelease).",
      refusedBy: ["K7"],
    },
    ["ReactAndroid/src/main/java/com/facebook/react/devsupport/inspector/DevSupportHttpClient.kt"],
  ),
  ...entries(
    {
      id: "R6",
      package: "react-native",
      what: "dev support's parse of Metro's bundle URL into a java.net.URL",
      verdict: ALLOWLISTED,
      reason: "Development tooling: it reads the path and host of the bundle URL and opens no connection.",
      refusedBy: ["K5"],
    },
    ["ReactAndroid/src/main/java/com/facebook/react/devsupport/DevSupportManagerBase.kt"],
  ),
  // --- react-native-worklets, a direct dependency (spec check issue 3) ---
  ...entries(
    {
      id: "W1",
      package: "react-native-worklets",
      what: "fetch and XMLHttpRequest on a worklet runtime, over React Native's client",
      verdict: ALLOWLISTED,
      reason:
        "Installed only on worklet runtimes in Bundle Mode (src/networking/install.ts), and reached from JavaScript through the global fetch or XMLHttpRequest, which T1 refuses in the app.",
      refusedBy: ["T1", "K7"],
    },
    ["android/src/main/java/com/swmansion/worklets/networking/Networking.kt"],
  ),
  ...entries(
    {
      id: "W2",
      package: "react-native-worklets",
      what: "the worklet bundle's download from Metro over HttpURLConnection",
      verdict: ALLOWLISTED,
      reason: "Development tooling: it downloads the development bundle from Metro and carries no token.",
      refusedBy: ["K5", "K7"],
    },
    ["android/src/main/java/com/swmansion/worklets/ScriptBufferWrapper.kt"],
  ),
];
