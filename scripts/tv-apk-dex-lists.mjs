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
      {
        // A constructor is not inherited, so the javax.net.ssl subclasses' own <init> (which an APK subclass's super call
        // names) are listed too.
        classes: ["java.net.Socket", "java.net.ServerSocket", "java.net.DatagramSocket", "java.net.MulticastSocket", "javax.net.ssl.SSLSocket", "javax.net.ssl.SSLServerSocket"],
        names: ["<init>"],
      },
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
      // The providers behind each channel's open (review fix, T3-19): SelectorProvider.provider().openServerSocketChannel()
      // opens a listening channel without naming ServerSocketChannel.open (android.jar 37.1, javap).
      { classes: ["java.nio.channels.spi.SelectorProvider"], names: ["openSocketChannel", "openServerSocketChannel", "openDatagramChannel"] },
      { classes: ["java.nio.channels.spi.AsynchronousChannelProvider"], names: ["openAsynchronousSocketChannel", "openAsynchronousServerSocketChannel"] },
    ],
    // What a one-client class (ONE_CLIENT_CLASSES.S4) may do of this kind: make a client socket. Everything else in
    // `methods`, a listening or datagram socket above all, fails D1 there too (T3-29). A method added to `methods` is
    // not exempt until it is listed here with a reason. `descriptors`, when present, names the only overloads (their
    // parameter list, as `localOverloads` does) that are exempt: java.net.Socket also has Socket(String, int, boolean)
    // and Socket(InetAddress, int, boolean), which make a datagram socket when the flag is false, and the protected
    // Socket(SocketImpl) (android.jar 37.1, javap). DirectSocketFactory builds only Socket(Proxy) (review fix, T3-29).
    oneClientMethods: [
      { classes: ["java.net.Socket"], names: ["<init>"], descriptors: ["(Ljava/net/Proxy;)"] },
      { classes: ["javax.net.SocketFactory"], names: ["createSocket"] },
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
      // MediaPlayer.create(Context, Uri) loads the URI as setDataSource does (review fix, T3-19; name-only, as
      // setDataSource is, so the resource overloads count too).
      { classes: ["android.media.MediaPlayer"], names: ["setDataSource", "create"] },
      // MediaExtractor.setDataSource and MediaMetadataRetriever.setDataSource take an http URL with headers (String, Map),
      // a path or URL (String), or a Uri (review fix, T3-19). Every overload is a sink except those whose parameters can
      // name only an open file or the app's own MediaDataSource (android.jar 37.1, javap): the file was opened elsewhere,
      // where that opener is judged. A new overload is a sink until it is listed here. Fresco's
      // LocalVideoThumbnailProducer reads a local video's frame with setDataSource(FileDescriptor).
      {
        classes: ["android.media.MediaExtractor", "android.media.MediaMetadataRetriever"],
        names: ["setDataSource"],
        localOverloads: ["(Ljava/io/FileDescriptor;)", "(Ljava/io/FileDescriptor;JJ)", "(Landroid/media/MediaDataSource;)", "(Landroid/content/res/AssetFileDescriptor;)"],
      },
      { classes: ["android.widget.VideoView"], names: ["setVideoURI", "setVideoPath"] },
      { classes: ["android.net.Network"], names: ["openConnection", "getSocketFactory", "bindSocket"] },
    ],
  },
];

// Framework classes and their framework superclass, for every class in android.jar 37.1 that extends a class a sink
// method names (found with javap over every class in the jar; review fix, T3-19). The APK holds no
// framework class, so its declarations cannot say that android.net.SSLCertificateSocketFactory.createSocket is
// SocketFactory.createSocket; this table does. A fact about the platform, not a policy list, so the judge reads it
// directly and a test's own lists cannot drop it.
export const FRAMEWORK_SUPERCLASSES = {
  "android.net.SSLCertificateSocketFactory": "javax.net.ssl.SSLSocketFactory",
  "javax.net.ssl.SSLSocketFactory": "javax.net.SocketFactory",
  "javax.net.ssl.SSLServerSocketFactory": "javax.net.ServerSocketFactory",
  "javax.net.ssl.SSLSocket": "java.net.Socket",
  "javax.net.ssl.SSLServerSocket": "java.net.ServerSocket",
  "java.net.MulticastSocket": "java.net.DatagramSocket",
  "java.net.HttpURLConnection": "java.net.URLConnection",
  "javax.net.ssl.HttpsURLConnection": "java.net.HttpURLConnection",
  "java.net.JarURLConnection": "java.net.URLConnection",
};

// Frames whose holder starts with one of these are dropped: OkHttp's own sockets are reached only through a client,
// and S1 catches every holder of a client.
export const LIBRARY_INTERNAL = ["okhttp3.", "okio."];

// Octave's code may hold a sink only in these classes, per sink id (NetworkPathRules.kt's ONE_CLIENT_CLASSES; the
// socket factory the one client dials with). Matched exactly. A sink matched through `methods` is exempt here only for
// the pairs on its row's `oneClientMethods` (T3-29): DirectSocketFactory may make a client socket, nothing else of S4. They may be absent: R8 removes OctaveHttp until T3-05
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
    reason: `${DEV} ReactHostImpl holds one because loadNetworkResource (with InspectorNetworkHelper inlined) reads DevSupportHttpClient's client; it is called from C++ only by the inspector target; scripts/tv-apk-native-inspector.mjs (T3-28) fails when a native library of the APK is wired to the C++ dispatcher that calls it, and that the dispatcher is the only route is read from source (runtime/ReactHostImpl.kt, devsupport/inspector/InspectorNetworkHelper.kt).`,
    linkedPath: "R5",
  },
  // --- Expo (E1, E3); expo-file-system (E2) and @expo/dom-webview (E5) are unlinked, so on ABSENT_PACKAGES ---
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
    id: "X4",
    classes: ["expo.modules.asset.ResourceAssetKt"],
    sinks: ["S1"],
    what: "expo-asset's download of a remote asset",
    reason: "openRemoteStream fetches a remote asset over React Native's client (expo-asset, android/src/main/java/expo/modules/asset/ResourceAsset.kt:65-71); the app loads bundled assets only.",
    linkedPath: "E3",
  },
  // --- react-native-worklets (W1, W2) ---
  {
    id: "W3",
    classes: ["com.swmansion.worklets.networking.Networking"],
    sinks: ["S1"],
    what: "fetch and XMLHttpRequest on a worklet runtime",
    reason: "Holds React Native's client for worklet runtimes in Bundle Mode (react-native-worklets, android/src/main/java/com/swmansion/worklets/networking/Networking.kt); reached from JavaScript only, which T1 refuses in the app. It also covers R8's merged lambda dispatch that calls its client getter: a sink at a synthetic-only site outside Octave's code is judged by the referenced member's holder, not by the lambda group's name (T3-19 review fix).",
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
  // --- Media3 (T8-02) ---
  {
    id: "M1",
    classes: ["androidx.media3.datasource.okhttp.OkHttpDataSource"],
    sinks: ["S1"],
    what: "the player's media requests",
    reason:
      "Media3's HTTP data source (media3-datasource-okhttp 1.11.1, OkHttpDataSource.java) invokes Call.Factory.newCall on the factory it is built with; Octave's engine builds it only over OctaveHttp.callFactory(session) (dev.octave.player.media3, D4_EXCEPTIONS), so every media request is the one client's. No other Media3 data source is built.",
    linkedPath: null,
  },
];

// The references D4 lets Octave make to a listed class (Product Owner ruling of 2026-11-23, T8-02): each entry is one
// constructor of one library class from one Octave package. A reference passes only when its frame is a real (not
// synthetic) frame of a class under `package`, the name it references is exactly `class`, attributed to that one
// original, and it is a `new-instance` of the class, an `invoke-direct` of `constructor`, or that constructor inlined
// by R8 into the Octave method. Every other member, cast, type check, class literal, field, parameter or return type
// fails D4 as before. An entry no reference in the APK uses fails the check, as a stale row fails D3.
export const D4_EXCEPTIONS = [
  {
    id: "E1",
    package: "dev.octave.player.media3.",
    class: "androidx.media3.datasource.okhttp.OkHttpDataSource$Factory",
    constructor: ["okhttp3.Call$Factory"],
    reason:
      "The engine hands Media3's OkHttp data source the one client's call factory, OctaveHttp.callFactory(session), and sets nothing else on it; the dex check does not trace which factory is passed: decision log 14's D1 rule, T8-02's item 1 source test and its wire test hold that.",
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
    offInRelease: "loadNetworkResource is @DoNotStrip and called from C++ by the inspector target, which ReactHostImpl creates only when InspectorFlags.getFuseboxEnabled() (runtime/ReactHostImpl.kt:442-445, 1591-1593; jsinspector-modern/InspectorFlags.cpp:66-74, default false). If it ran, a connected debugger could make the app fetch any URL. Tested (T3-28): scripts/tv-apk-native-inspector.mjs fails when a native library of the APK is wired to call the C++ inspector's network dispatcher (NetworkIOAgent::handleRequest), the one C++ route from a debugger message to loadNetworkResource; that it is the only route, and the run-time flag, are read from source.",
  },
];

// Java packages that must not be in the APK: the excluded Expo modules and T3-04's K4 stacks R8 would rename.
export const ABSENT_PACKAGES = [
  // The Java packages of the Expo modules apps/tv/package.json excludes from autolinking (T3-19 item 3).
  "expo.modules.filesystem.",
  "expo.modules.logbox.",
  "expo.modules.webview.",
  // The stacks T3-04's K4 names, which R8 would rename.
  "org.chromium.net.",
  "com.android.volley.",
  "coil.",
  "coil3.",
  "com.bumptech.glide.",
  "com.squareup.picasso.",
];

// Of expo-file-system, expo-asset, @expo/log-box and @expo/dom-webview: the ones that stay linked, with the trial's
// evidence.
export const KEPT_EXPO_MODULES = [
  {
    package: "expo-asset",
    reason:
      "expo imports expo-asset at start-up (expo/src/Expo.fx.tsx), and expo-asset calls requireNativeModule('ExpoAsset') (expo-asset/src/ExpoAsset.ts), which throws when the module is not linked, so the app never reaches its first screen. Its one sink is row X4 (E3).",
    evidence:
      "T3-19 trial 4, 2026-11-22: with expo-asset excluded, pnpm tv:build and the dex check passed, and pnpm tv:smoke on an API 36 Android TV emulator failed: \"E ReactNativeJS: [runtime not ready]: Error: Cannot find native module 'ExpoAsset'\" then \"ERROR tv focus: no focus line arrived, before or after the press\".",
  },
];

// LINKED_NETWORK_PATHS ids whose package is linked but whose client no class holds in the release dex.
export const SOURCE_ONLY_LINKED_PATHS = [
  {
    id: "E7",
    reason:
      "R8 removed AppContext's okHttpClient getter and createOkHttpClientBuilder: the release mapping's AppContext section has no member line for either, and no class with a sink is attributed to AppContext. A source row stays because the file names OkHttpClientProvider.",
  },
  {
    id: "E8",
    reason:
      "URLTypConverter only builds a java.net.URL from a module argument and opens nothing (expo-modules-core, android/src/main/java/expo/modules/kotlin/types/net/URLTypConverter.kt); constructing a URL is not a sink, so no class stands for it in the dex.",
  },
  {
    id: "R6",
    reason:
      "DevSupportManagerBase only parses Metro's bundle URL into a java.net.URL, which is not a sink, and the release mapping names no member of it; a release build uses ReleaseDevSupportManager (devsupport/DefaultDevSupportManagerFactory.kt).",
  },
];

export const PRODUCTION_LISTS = {
  sinks: NETWORK_SINKS,
  libraryInternal: LIBRARY_INTERNAL,
  oneClient: ONE_CLIENT_CLASSES,
  hooks: ENTRY_POINT_HOOKS,
  entryPoints: APK_NETWORK_ENTRY_POINTS,
  devSupportCallers: DEV_SUPPORT_CLIENT_CALLERS,
  absentPackages: ABSENT_PACKAGES,
  d4Exceptions: D4_EXCEPTIONS,
};
