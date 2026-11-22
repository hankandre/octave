// The core must run on any host (DOMAINS.md, Dependency rules 1 and 2): no
// browser globals and no UI or platform framework. Hosts come in through ports.
// Time and randomness come only from the Clock and Crypto ports; only the
// reference adapters in packages/core/src/adapters/ may touch the host's
// timers, wall clock and crypto (T2-03), and only they may call fetch (T2-04).
import parser from "@typescript-eslint/parser";

const platformImports = ["react", "react-*", "react-native", "react-native-*", "@react-native/*", "expo", "expo-*", "@expo/*"];
const hostGlobals = ["window", "document", "localStorage", "sessionStorage", "navigator", "location"];
const takeTime = "Take time from the injected Clock (packages/core/src/ports/clock.ts).";
const takeCrypto = "Take hashing and random ids from the injected Crypto (packages/core/src/ports/crypto.ts).";
const useTransport = "Reach the server through the injected Transport (packages/core/src/ports/transport.ts).";
const useAPort = "The core runs on any host. Take what you need through a port and let the app supply it.";

const browserGlobals = hostGlobals.map((name) => ({ name, message: useAPort }));
const clockGlobals = ["setTimeout", "clearTimeout", "setInterval", "clearInterval"];

// apps/tv keeps tvOS possible (decision 0003): shared TypeScript calls no Android-only API and reaches no native module
// directly. Such code goes in a `.android.ts` or `.android.tsx` file with a sibling the tvOS build can load.
const androidOnly = ["ToastAndroid", "PermissionsAndroid", "DrawerLayoutAndroid", "ProgressBarAndroid", "DatePickerAndroid", "TimePickerAndroid", "NativeModules", "TurboModuleRegistry"];
const nativeModuleLoaders = ["requireNativeModule", "requireOptionalNativeModule", "requireNativeViewManager"];
const platformFile = "Android-only. Put this in a `.android.ts` file with a sibling the tvOS build can load, or take it through a port.";
const bannedNames = `/^(${[...androidOnly, ...nativeModuleLoaders].join("|")})$/`;
const platformModules = "/^(react-native|expo|expo-modules-core)$/";

// Only the composition root constructs adapters (DOMAINS.md, Dependency rule 4): expo-crypto sits behind the core's
// Crypto port, in apps/tv/src/host/ alone (T3-02).
const hostOnly = { name: "expo-crypto", message: "expo-crypto is the Crypto port's adapter. Import hostCrypto from apps/tv/src/host/crypto.ts." };
const platformPaths = [
  { name: "react-native", importNames: androidOnly, message: platformFile },
  { name: "expo-modules-core", importNames: nativeModuleLoaders, message: platformFile },
  { name: "expo", importNames: nativeModuleLoaders, message: platformFile },
];
const platformSyntax = [
  { selector: `MemberExpression[property.name=${bannedNames}]`, message: platformFile },
  {
    selector: `VariableDeclarator[init.callee.name='require'][init.arguments.0.value=${platformModules}] > ObjectPattern > Property[key.name=${bannedNames}]`,
    message: platformFile,
  },
];

// T3-04: no network path from the app's JavaScript (decision 0005). The app's transport is the native session module,
// so no file under apps/tv (or a module's JavaScript, once modules/ is linted) sends, holds a token or names a header.
// Flat config replaces a rule's options per file, so every apps/tv block below spreads these arrays into its own.
// The ids T1 to T7 are the spec's (docs/specs/T3-04.md); scripts/network-lint.test.ts holds the messages. Each message
// ends with its id because ESLint's default formatter drops a message's final full stop.
const id = (rule, text) => `${text} (T3-04 ${rule})`;
const sendsNothing = id(
  "T1",
  "The app sends nothing from JavaScript (decision 0005). Call the gateway in `@octave/core`; it sends through the Transport port and the native session module.",
);
const holdsNoToken = id("T2", "JavaScript holds no token and sends no header (decision 0005). Pass the session id; native code adds the header.");
const bundledImagesOnly = id(
  "T3",
  'React Native\'s `Image` shows bundled assets only: `source={require("./file.png")}`. Server artwork goes through the native image view (T3-11); video through the PlayerEngine launch request.',
);
const ownHttpPath = id(
  "T4",
  "This package opens its own HTTP path, which cannot send the header. Use the gateway in `@octave/core` for data and the native image view (T3-11) for artwork.",
);
const noWebView = id("T5", "A WebView cannot send the header (invariant I7). Build the screen from the shared native controls.");
const noFetchTransport = id(
  "T7",
  "The core's fetch transport sends from JavaScript over React Native's client, with a header built in JavaScript (decision 0005). Call the gateway in `@octave/core`; the app's transport is the native session module.",
);

const sendingGlobals = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"];
const imageCalls = ["prefetch", "prefetchWithMetadata", "getSize", "getSizeWithHeaders", "queryCache"];
// esquery's regex literals cannot hold `/`, so a slash is written \x2F.
const ownHttpModules = "/^(expo\\x2Ffetch|expo-file-system(\\x2F.*)?|expo-asset(\\x2F.*)?|@expo\\x2Flog-box(\\x2F.*)?|@expo\\x2Fdom-webview(\\x2F.*)?|expo-image(\\x2F.*)?)$/";
const fetchTransportModule = "/(^|\\x2F)adapters\\x2Ffetch-transport(\\.[cm]?[jt]s)?$/";
const secretKeys = "/^(headers|authorization|token|accesstoken|apikey|api_key|x-emby-token|x-emby-authorization|x-mediabrowser-token)$/i";
const imageSources = "/^(source|src|srcSet|defaultSource|loadingIndicatorSource)$/";
// React Native's networking and image loading below its globals: the modules behind fetch, XMLHttpRequest, WebSocket
// and Image, and the native modules they call, by name (NativeModules.X, TurboModuleRegistry.get("X"),
// requireNativeModule("X")). Names read from react-native-tvos 0.88.1 and Expo SDK 58.
const rnSendingPaths = "/^react-native[^\\x2F]*\\x2F(Libraries\\x2F(Network|WebSocket)\\x2F|src\\x2F.*\\x2FNative(Networking|WebSocketModule))/";
const rnImagePaths = "/^react-native[^\\x2F]*\\x2F(Libraries\\x2FImage\\x2F|src\\x2F.*\\x2FNative(ImageLoader|Fresco))/";
const nativeModuleNames = (names) => `/^(${names.join("|")})$/`;
const sendingModules = nativeModuleNames(["Networking", "WebSocketModule", "ExpoFetchModule"]);
const imageModules = nativeModuleNames(["ImageLoader", "FrescoModule"]);
const ownHttpNativeModules = nativeModuleNames(["FileSystem", "ExponentFileSystem", "ExpoAsset", "ExpoDomWebViewModule"]);
const byNativeName = (names, message) => [
  { selector: `MemberExpression[property.name=${names}]`, message },
  { selector: `MemberExpression[computed=true][property.value=${names}]`, message },
  { selector: `ObjectPattern > Property[key.name=${names}]`, message },
  { selector: `CallExpression[arguments.0.value=${names}]`, message },
];

const networkGlobals = sendingGlobals.map((name) => ({ name, message: sendsNothing }));
const networkProperties = [
  ...["globalThis", "global", "window", "self"].flatMap((object) => sendingGlobals.map((property) => ({ object, property, message: sendsNothing }))),
  ...imageCalls.map((property) => ({ object: "Image", property, message: bundledImagesOnly })),
];
const networkPaths = [
  ...["expo/fetch", "expo-file-system", "expo-asset", "@expo/log-box", "@expo/dom-webview", "expo-image"].map((name) => ({ name, message: ownHttpPath })),
];
const networkPatterns = [
  { group: ["expo-file-system/*", "expo-asset/*", "@expo/log-box/*", "@expo/dom-webview/*", "expo-image/*"], message: ownHttpPath },
  { group: ["**/adapters/fetch-transport", "**/adapters/fetch-transport.*"], message: noFetchTransport },
  {
    group: ["react-native*/Libraries/Network/*", "react-native*/Libraries/WebSocket/*", "react-native*/src/**/NativeNetworking*", "react-native*/src/**/NativeWebSocketModule*"],
    message: sendsNothing,
  },
  { group: ["react-native*/Libraries/Image/*", "react-native*/src/**/NativeImageLoader*", "react-native*/src/**/NativeFresco*"], message: bundledImagesOnly },
];
const networkSyntax = [
  // T2: a header or token as a property, a class field or a JSX attribute; the MediaBrowser header as text.
  { selector: `Property[key.name=${secretKeys}]`, message: holdsNoToken },
  { selector: `Property[key.value=${secretKeys}]`, message: holdsNoToken },
  { selector: `PropertyDefinition[key.name=${secretKeys}]`, message: holdsNoToken },
  { selector: `JSXAttribute[name.name=${secretKeys}]`, message: holdsNoToken },
  { selector: "Literal[value=/MediaBrowser\\s[\\s\\S]*Token=/]", message: holdsNoToken },
  { selector: "TemplateLiteral:has(TemplateElement[value.raw=/MediaBrowser\\s/]):has(TemplateElement[value.raw=/Token=/])", message: holdsNoToken },
  // T3: React Native's Image takes bundled assets only.
  {
    selector: `JSXAttribute[name.name=${imageSources}]:not([value.type='JSXExpressionContainer'][value.expression.type='CallExpression'][value.expression.callee.name='require'][value.expression.arguments.length=1][value.expression.arguments.0.type='Literal'])`,
    message: bundledImagesOnly,
  },
  { selector: "Property[key.name='uri']", message: bundledImagesOnly },
  { selector: "Property[key.value='uri']", message: bundledImagesOnly },
  // Image's network calls on any object: `RN.Image.prefetch`, and `Image` imported under another name.
  { selector: `MemberExpression[property.name=/^(${imageCalls.join("|")})$/]`, message: bundledImagesOnly },
  // T1: the sending globals read from any object, such as an alias of globalThis (`const g = globalThis; g.fetch`).
  { selector: `MemberExpression[property.name=/^(${sendingGlobals.join("|")})$/]`, message: sendsNothing },
  // T1, T3 and T4: React Native's and Expo's networking modules by path and by native module name.
  { selector: `CallExpression[callee.name='require'][arguments.0.value=${rnSendingPaths}]`, message: sendsNothing },
  { selector: `ImportExpression[source.value=${rnSendingPaths}]`, message: sendsNothing },
  { selector: `CallExpression[callee.name='require'][arguments.0.value=${rnImagePaths}]`, message: bundledImagesOnly },
  { selector: `ImportExpression[source.value=${rnImagePaths}]`, message: bundledImagesOnly },
  ...byNativeName(sendingModules, sendsNothing),
  ...byNativeName(imageModules, bundledImagesOnly),
  ...byNativeName(ownHttpNativeModules, ownHttpPath),
  // T4 and T7 for require() and import(), which no-restricted-imports does not see.
  { selector: `CallExpression[callee.name='require'][arguments.0.value=${ownHttpModules}]`, message: ownHttpPath },
  { selector: `ImportExpression[source.value=${ownHttpModules}]`, message: ownHttpPath },
  { selector: `CallExpression[callee.name='require'][arguments.0.value=${fetchTransportModule}]`, message: noFetchTransport },
  { selector: `ImportExpression[source.value=${fetchTransportModule}]`, message: noFetchTransport },
  // T5.
  { selector: "ExpressionStatement[directive='use dom']", message: noWebView },
];
const networkImports = (paths) => ["error", { paths: [...paths, ...networkPaths], patterns: networkPatterns }];
const networkRules = {
  "no-restricted-globals": ["error", ...networkGlobals],
  "no-restricted-properties": ["error", ...networkProperties],
  "no-restricted-imports": networkImports([]),
  "no-restricted-syntax": ["error", ...networkSyntax],
};
const appFiles = ["apps/tv/**/*.{ts,tsx,js,jsx,mjs,cjs}", "modules/*/src/**/*.{ts,tsx,js,jsx,mjs,cjs}", "modules/*/index.{ts,js}"];

export default [
  {
    ignores: ["apps/tv/android/**", "apps/tv/ios/**", "apps/tv/.expo/**", "apps/tv/dist/**"],
  },
  {
    files: ["apps/tv/**/*.{ts,tsx}", "modules/*/src/**/*.{ts,tsx}", "modules/*/index.ts"],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  // The app's JavaScript parses JSX too, so a JSX sample in a .js file meets the network rules, not a parse error.
  {
    files: ["apps/tv/**/*.{js,jsx,mjs,cjs}", "modules/*/src/**/*.{js,jsx,mjs,cjs}", "modules/*/index.js"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  // T3-04's network rules for every app file; the blocks below restate them beside the platform rules.
  {
    files: appFiles,
    rules: networkRules,
  },
  {
    files: ["apps/tv/**/*.{ts,tsx}"],
    ignores: ["apps/tv/**/*.android.ts", "apps/tv/**/*.android.tsx"],
    rules: {
      "no-restricted-imports": networkImports([...platformPaths, hostOnly]),
      // The same names reached without a named import: `RN.ToastAndroid` and `require("react-native").NativeModules`.
      "no-restricted-syntax": ["error", ...platformSyntax, ...networkSyntax],
    },
  },
  // Flat config replaces a rule's options, so the host folder restates the platform paths without expo-crypto.
  {
    files: ["apps/tv/src/host/**/*.{ts,tsx}"],
    ignores: ["apps/tv/**/*.android.ts", "apps/tv/**/*.android.tsx"],
    rules: {
      "no-restricted-imports": networkImports(platformPaths),
    },
  },
  // Files the block above does not cover (Android-only files and JavaScript) still cannot reach expo-crypto.
  {
    files: ["apps/tv/**/*.android.ts", "apps/tv/**/*.android.tsx", "apps/tv/**/*.{js,jsx,mjs,cjs}"],
    ignores: ["apps/tv/src/host/**"],
    rules: {
      "no-restricted-imports": networkImports([hostOnly]),
    },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    languageOptions: { parser },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    ignores: ["packages/core/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: platformImports, message: useAPort }] }],
    },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    ignores: ["packages/core/src/**/*.test.ts", "packages/core/src/adapters/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...browserGlobals,
        ...clockGlobals.map((name) => ({ name, message: takeTime })),
        { name: "crypto", message: takeCrypto },
        { name: "fetch", message: useTransport },
        { name: "XMLHttpRequest", message: useTransport },
        { name: "WebSocket", message: id("T6", useTransport) },
        { name: "EventSource", message: id("T6", useTransport) },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: takeTime },
        { object: "Math", property: "random", message: takeCrypto },
        ...clockGlobals.map((property) => ({ object: "globalThis", property, message: takeTime })),
        { object: "globalThis", property: "crypto", message: takeCrypto },
        { object: "globalThis", property: "fetch", message: useTransport },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: takeTime },
        { selector: "CallExpression[callee.name='Date']", message: takeTime },
      ],
    },
  },
  {
    files: ["packages/core/src/adapters/**/*.ts"],
    ignores: ["packages/core/src/**/*.test.ts"],
    rules: {
      "no-restricted-globals": ["error", ...browserGlobals],
    },
  },
];
