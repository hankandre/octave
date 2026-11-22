// The lists scripts/tv-apk-dex.mjs judges the release APK's dex with (T3-19, docs/specs/T3-19.md, "The lists").
// NETWORK_SINKS says what can open a connection; LIBRARY_INTERNAL is the library behind the one client; the other lists
// name, with a reason each, every class outside Octave that may hold a sink. Removing a sink needs the spec's decision
// log; adding a row needs a reason a reviewer can check against the class's source.

// An instruction is a sink reference when it names one of these. `anyReference` is matched against every class an
// instruction names (its owner, a type operand, or a type in its descriptor), exactly; `anyReferencePrefix` against the
// start of the name; `methods` against an invoked method's original class and name, also when the owner is a subclass
// the APK declares.
export const NETWORK_SINKS = [
  {
    id: "S1",
    what: "an OkHttp client, its builder, or a call or web socket factory invoke",
    reason:
      "Every OkHttp request starts at an OkHttpClient or a factory; Octave's one client is OctaveHttp. A descriptor or a declaration that has the client's type counts too (decision log 15).",
    anyReference: ["okhttp3.OkHttpClient", "okhttp3.OkHttpClient$Builder"],
    factoryInvokes: ["okhttp3.Call$Factory", "okhttp3.WebSocket$Factory"],
    declarations: true,
  },
  {
    id: "S2",
    what: "java.net.URL opening a connection",
    reason: "URL.openConnection, openStream and getContent connect to the URL's host with the JDK's own stack.",
    methods: [{ classes: ["java.net.URL"], names: ["openConnection", "openStream", "getContent"] }],
  },
  {
    id: "S3",
    what: "a URLConnection",
    reason: "The JDK's HTTP and JAR connections send without the one client's origin, redirect and proxy policy.",
    anyReference: ["java.net.URLConnection", "java.net.HttpURLConnection", "java.net.JarURLConnection", "javax.net.ssl.HttpsURLConnection"],
  },
  {
    id: "S4",
    what: "a socket, a listening socket, or a socket factory",
    reason: "A raw or listening socket reaches any address; a listening one is a way in, the owner's first worry.",
    methods: [
      { classes: ["java.net.Socket", "java.net.ServerSocket", "java.net.DatagramSocket", "java.net.MulticastSocket"], names: ["<init>"] },
      {
        classes: [
          "java.nio.channels.SocketChannel",
          "java.nio.channels.ServerSocketChannel",
          "java.nio.channels.DatagramChannel",
          "java.nio.channels.AsynchronousSocketChannel",
          "java.nio.channels.AsynchronousServerSocketChannel",
        ],
        names: ["open"],
      },
      {
        classes: ["javax.net.SocketFactory", "javax.net.ServerSocketFactory", "javax.net.ssl.SSLSocketFactory", "javax.net.ssl.SSLServerSocketFactory"],
        names: ["createSocket", "createServerSocket"],
      },
    ],
  },
  {
    id: "S5",
    what: "a WebView loading a page",
    reason: "A WebView fetches its page and everything the page names with the system's network stack.",
    methods: [{ classes: ["android.webkit.WebView"], names: ["<init>", "loadUrl", "loadData", "loadDataWithBaseURL", "postUrl"] }],
  },
  {
    id: "S6",
    what: "another platform HTTP stack, player URL, download manager or network-bound socket",
    reason: "Each fetches a URL itself, outside the one client (T3-04's K4).",
    anyReference: ["android.app.DownloadManager"],
    anyReferencePrefix: ["android.net.http.", "java.net.http.", "android.app.DownloadManager$"],
    methods: [
      { classes: ["android.media.MediaPlayer"], names: ["setDataSource"] },
      { classes: ["android.widget.VideoView"], names: ["setVideoURI", "setVideoPath"] },
      { classes: ["android.net.Network"], names: ["openConnection", "getSocketFactory", "bindSocket"] },
    ],
  },
];

// Frames whose holder starts with one of these are dropped: OkHttp's own sockets are reached only through a client,
// and S1 catches every holder of a client.
export const LIBRARY_INTERNAL = ["okhttp3.", "okio."];

// Octave's code may hold a sink only in these classes, per sink id (NetworkPathRules.kt's ONE_CLIENT_CLASSES; the
// socket factory the one client dials with). Matched exactly. They may be absent: R8 removes OctaveHttp until T3-05
// calls it.
export const ONE_CLIENT_CLASSES = {
  S1: ["dev.octave.session.http.OctaveHttp", "dev.octave.session.http.SessionCallFactory"],
  S4: ["dev.octave.session.http.DirectSocketFactory"],
};

// T3-04's K7 client hooks: Octave's code may not reference them, whether or not they hold a sink in this APK.
export const ENTRY_POINT_HOOKS = [
  "com.facebook.react.modules.network.OkHttpClientProvider",
  "com.facebook.react.modules.network.OkHttpClientFactory",
  "com.facebook.react.modules.network.CustomClientBuilder",
  "com.facebook.react.devsupport.inspector.DevSupportHttpClient",
];

const RN = "react-native-tvos 0.88.1-0, ReactAndroid/src/main/java/com/facebook/react/";
const DEV = "Dev support: built only by a development or perf-test dev support manager, never by the ReleaseDevSupportManager a release build uses (devsupport/DefaultDevSupportManagerFactory.kt); DEV_SUPPORT_CLIENT_CALLERS holds who reaches the client.";

// Every class outside Octave that holds a sink in the release APK: { id, classes, sinks, what, reason, linkedPath }.
// Built from the check's own output on the release build (docs/specs/T3-19.md, "The lists"). A class matches its
// nested classes too (Name$…).
export const APK_NETWORK_ENTRY_POINTS = [
  // --- React Native (R1 to R3, R5) ---
  {
    id: "N1",
    classes: ["com.facebook.react.modules.network.NetworkingModule", "com.facebook.react.common.network.OkHttpCallUtil"],
    sinks: ["S1"],
    what: "JavaScript fetch and XMLHttpRequest, and its cancel-by-tag helper",
    reason: `NetworkingModule holds React Native's OkHttpClient (${RN}modules/network/NetworkingModule.kt); OkHttpCallUtil.cancelTag only walks that client's dispatcher (common/network/OkHttpCallUtil.kt). JavaScript holds no token; ESLint T1 refuses fetch in the app.`,
    linkedPath: "R1",
  },
  {
    id: "N2",
    classes: ["com.facebook.react.modules.network.OkHttpClientProvider"],
    sinks: ["S1"],
    what: "React Native's shared OkHttpClient",
    reason: `Builds and hands out React Native's client (${RN}modules/network/OkHttpClientProvider.kt); K7 and D4 refuse it in Octave's code.`,
    linkedPath: "R1",
  },
  {
    id: "N3",
    classes: ["com.facebook.react.modules.network.RequestBodyUtil"],
    sinks: ["S2"],
    what: "NetworkingModule's read of a request body from a URL",
    reason: `getFileInputStream opens a request body's URL for NetworkingModule (${RN}modules/network/RequestBodyUtil.kt); only JavaScript fetch reaches it.`,
    linkedPath: "R1",
  },
  {
    id: "N4",
    classes: ["com.facebook.react.modules.websocket.WebSocketModule"],
    sinks: ["S1"],
    what: "JavaScript WebSocket",
    reason: `Opens a web socket over React Native's client for JavaScript (${RN}modules/websocket/WebSocketModule.kt); Metro's reload channel in a debug build, refused in the app by T1.`,
    linkedPath: "R2",
  },
  {
    id: "N5",
    classes: ["com.facebook.react.modules.fresco.FrescoModule", "com.facebook.react.modules.fresco.ReactOkHttpNetworkFetcher"],
    sinks: ["S1"],
    what: "React Native Image's network fetcher",
    reason: `FrescoModule's default config fetches network images over React Native's client through ReactOkHttpNetworkFetcher (${RN}modules/fresco/FrescoModule.kt); the app draws bundled assets only and server artwork goes through the native image view (T3-11).`,
    linkedPath: "R3",
  },
  {
    id: "N6",
    classes: ["com.facebook.imagepipeline.backends.okhttp3.OkHttpNetworkFetcher", "com.facebook.imagepipeline.backends.okhttp3.OkHttpImagePipelineConfigFactory"],
    sinks: ["S1"],
    what: "Fresco's OkHttp fetcher, the base of ReactOkHttpNetworkFetcher",
    reason: "Fresco's imagepipeline-okhttp3 (a binary library): the fetcher React Native's Image uses, and the config factory FrescoModule builds it with. Same path as N5.",
    linkedPath: "R3",
  },
  {
    id: "N7",
    classes: ["com.facebook.imagepipeline.producers.HttpUrlConnectionNetworkFetcher"],
    sinks: ["S2", "S3"],
    what: "Fresco's default fetcher over HttpURLConnection",
    reason: "Fresco's imagepipeline (a binary library) keeps its default network fetcher; React Native replaces it with ReactOkHttpNetworkFetcher (N5). No source row stands for a binary library.",
    linkedPath: null,
  },
  {
    id: "N8",
    classes: [
      "com.facebook.react.devsupport.inspector.DevSupportHttpClient",
      "com.facebook.react.devsupport.inspector.InspectorNetworkHelper",
      "com.facebook.react.devsupport.CxxInspectorPackagerConnection$DelegateImpl",
      "com.facebook.react.devsupport.DevServerHelper",
      "com.facebook.react.devsupport.PackagerStatusCheck",
      "com.facebook.react.devsupport.BundleDownloader",
      "com.facebook.react.runtime.ReactHostImpl",
    ],
    sinks: ["S1"],
    what: "the development server's and the inspector's clients",
    reason: `${DEV} ReactHostImpl holds one because loadNetworkResource (with InspectorNetworkHelper inlined) reads DevSupportHttpClient's client; it is called from C++ only by the inspector target, whose gate is read from source and not tested (runtime/ReactHostImpl.kt, devsupport/inspector/InspectorNetworkHelper.kt).`,
    linkedPath: "R5",
  },
  // --- Expo (E1 to E3, E5) ---
  {
    id: "X1",
    classes: ["expo.modules.fetch.ExpoFetchModule", "expo.modules.fetch.NativeRequest"],
    sinks: ["S1"],
    what: "expo/fetch over React Native's client",
    reason: "expo/fetch builds its requests on React Native's client (expo 58.0.26, android/src/main/java/expo/modules/fetch/ExpoFetchModule.kt, NativeRequest.kt). JavaScript holds no token; T1 refuses fetch in the app.",
    linkedPath: "E1",
  },
  {
    id: "X2",
    classes: ["expo.modules.fetch.OkHttpFileUrlInterceptor"],
    sinks: ["S3"],
    what: "expo/fetch's file: URL interceptor",
    reason: "Names URLConnection only for URLConnection.guessContentTypeFromName, a MIME guess that opens nothing (expo 58.0.26, android/src/main/java/expo/modules/fetch/OkHttpFileUrlInterceptor.kt:99).",
    linkedPath: "E1",
  },
  {
    id: "X3",
    classes: [
      "expo.modules.filesystem.FileSystemDownloadKt",
      "expo.modules.filesystem.FileSystemDownloadTask",
      "expo.modules.filesystem.FileSystemDownloadTaskKt",
      "expo.modules.filesystem.FileSystemUploadTask",
      "expo.modules.filesystem.FileSystemUploadTaskKt",
      "expo.modules.filesystem.FileSystemModule",
      "expo.modules.filesystem.legacy.FileSystemLegacyModule",
      "expo.modules.kotlin.activityresult.DataPersistor",
    ],
    sinks: ["S1", "S3"],
    what: "expo-file-system's downloads and uploads",
    reason: "expo-file-system builds its own OkHttpClient and uses React Native's for downloads and uploads; its URLConnection use is a MIME guess (android/src/main/java/expo/modules/filesystem/). DataPersistor's dex class holds R8's class-initialisation read of FileSystemUploadTask's client, attributed to DataPersistor's line.",
    linkedPath: "E2",
  },
  {
    id: "X4",
    classes: ["expo.modules.asset.ResourceAssetKt"],
    sinks: ["S1"],
    what: "expo-asset's download of a remote asset",
    reason: "openRemoteStream fetches a remote asset over React Native's client (expo-asset, android/src/main/java/expo/modules/asset/ResourceAsset.kt:65-71); the app loads bundled assets only.",
    linkedPath: "E3",
  },
  {
    id: "X5",
    classes: ["expo.modules.webview.DomWebView"],
    sinks: ["S5"],
    what: 'the WebView behind the "use dom" directive',
    reason: "@expo/dom-webview creates and loads a WebView (android/src/main/java/expo/modules/webview/DomWebView.kt); the app has no DOM component and I7 refuses a WebView for server content.",
    linkedPath: "E5",
  },
  {
    id: "X6",
    classes: ["expo.modules.crypto.aes.AesCryptoModule$$ExternalSyntheticLambda0"],
    sinks: ["S1"],
    what: "R8's merged lambda class (named after one of its lambdas)",
    reason: "A synthetic class R8 merged many lambdas into; one case of its invoke() calls worklets' Networking client getter (W1, row W3), attributed to the synthetic frame alone. It builds no client. Its name follows R8's choice and may change with a build.",
    linkedPath: "W1",
  },
  // --- react-native-worklets (W1, W2) ---
  {
    id: "W3",
    classes: ["com.swmansion.worklets.networking.Networking"],
    sinks: ["S1"],
    what: "fetch and XMLHttpRequest on a worklet runtime",
    reason: "Holds React Native's client for worklet runtimes in Bundle Mode (react-native-worklets, android/src/main/java/com/swmansion/worklets/networking/Networking.kt); reached from JavaScript only, which T1 refuses in the app.",
    linkedPath: "W1",
  },
  {
    id: "W4",
    classes: ["com.swmansion.worklets.ScriptBufferWrapper"],
    sinks: ["S2", "S3"],
    what: "the worklet bundle's download from Metro",
    reason: "downloadScriptToFile fetches the development bundle from Metro over HttpURLConnection (react-native-worklets, android/src/main/java/com/swmansion/worklets/ScriptBufferWrapper.kt); development tooling, it carries no token.",
    linkedPath: "W2",
  },
  // --- Kotlin ---
  {
    id: "K1",
    classes: ["kotlin.reflect.jvm.internal.impl.serialization.deserialization.builtins.BuiltInsResourceLoader"],
    sinks: ["S2", "S3"],
    what: "kotlin-reflect's read of its built-ins from the class path",
    reason: "loadResource opens the URL its own class loader returns for a resource path (a resource inside the APK) and reads it, as the dex shows: ClassLoader.getResource, then URL.openConnection with caches off. The URL never comes from input. No source row stands for the Kotlin runtime.",
    linkedPath: null,
  },
];

// Every class whose code references DevSupportHttpClient, with why it does not run in a release build.
export const DEV_SUPPORT_CLIENT_CALLERS = [
  {
    class: "com.facebook.react.devsupport.CxxInspectorPackagerConnection$DelegateImpl",
    offInRelease: "Built only for the inspector packager connection, which only a development or perf-test dev support manager opens (devsupport/DefaultDevSupportManagerFactory.kt:55-85; UNSTABLE_ENABLE_FUSEBOX_RELEASE is false). Read from source.",
  },
  {
    class: "com.facebook.react.devsupport.DevServerHelper",
    offInRelease: "Built only by DevSupportManagerBase, that is by a development or perf-test dev support manager; a release build uses ReleaseDevSupportManager (devsupport/DefaultDevSupportManagerFactory.kt:55-85). Read from source.",
  },
  {
    class: "com.facebook.react.devsupport.DevServerHelper$openInspectorConnection$1",
    offInRelease: "Started by DevServerHelper.openInspectorConnection, so only where DevServerHelper exists (see DevServerHelper). pnpm tv:smoke shows the release app opens no connection to the development server at start-up.",
  },
  {
    class: "com.facebook.react.runtime.ReactHostImpl",
    offInRelease: "loadNetworkResource is @DoNotStrip and called from C++ by the inspector target, which ReactHostImpl creates only when InspectorFlags.getFuseboxEnabled() (runtime/ReactHostImpl.kt:442-445, 1591-1593; jsinspector-modern/InspectorFlags.cpp:66-74, default false). Read from source, not tested: if it ran, a connected debugger could make the app fetch any URL.",
  },
];

// Java packages that must not be in the APK: the excluded Expo modules and T3-04's K4 stacks R8 would rename.
export const ABSENT_PACKAGES = ["org.chromium.net.", "com.android.volley.", "coil.", "coil3.", "com.bumptech.glide.", "com.squareup.picasso."];

// Of expo-file-system, expo-asset, @expo/log-box and @expo/dom-webview: the ones that stay linked, with the trial's
// evidence.
export const KEPT_EXPO_MODULES = [];

// LINKED_NETWORK_PATHS ids whose package is linked but whose client no class holds in the release dex.
export const SOURCE_ONLY_LINKED_PATHS = [];

export const PRODUCTION_LISTS = {
  sinks: NETWORK_SINKS,
  libraryInternal: LIBRARY_INTERNAL,
  oneClient: ONE_CLIENT_CLASSES,
  hooks: ENTRY_POINT_HOOKS,
  entryPoints: APK_NETWORK_ENTRY_POINTS,
  devSupportCallers: DEV_SUPPORT_CLIENT_CALLERS,
  absentPackages: ABSENT_PACKAGES,
};
