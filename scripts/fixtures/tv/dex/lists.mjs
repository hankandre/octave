// T3-19 test fixture (frozen): the lists the frozen dex tests judge release-dump.txt and release-mapping.txt with
// (spec, "Why the frozen dex tests use their own lists"). The sink definitions, LIBRARY_INTERNAL, the one-client classes
// and the K7 hooks describe the JVM and Octave's own rules, not what one APK holds, so they are the production ones. The
// entry points, the DevSupportHttpClient callers and the absent packages are fitted to the excerpts.
//
// Audit of the excerpts (dex method -> the line each sink reference sits on -> its frames after okhttp3./okio.):
// - v40.<clinit> (DevSupportHttpClient): lines 1-16 are OkHttpClientProvider.getOkHttpClient()/createClient() inlined
//   into DevSupportHttpClient.<clinit>; lines 17-118 are DevSupportHttpClient.<clinit> alone. Rows FX1 and FX2.
// - CxxInspectorPackagerConnection$DelegateImpl.<init> (lines 4-8) and .connectWebSocket (lines 25-27, the invoke of
//   OkHttpClient.newWebSocket on vr1): DelegateImpl, with DevSupportHttpClient.getWebsocketClient inlined at line 6.
//   Row FX3. Its <init> reads DevSupportHttpClient's fields: the one caller in DEV_SUPPORT_CALLERS.
// - NetworkingModule.<init>(ReactApplicationContext, String, OkHttpClient, List) (lines 47, 61-63, 73, 75): NetworkingModule
//   only. Row FX4.
// - lh0.<clinit> (expo.modules.filesystem.FileSystemDownloadKt, lines 1-11): FileSystemDownloadKt only. Row FX5.
// - sr1 (dev.octave.session.OctaveSessionModule): no sink; its references resolve to expo.modules.kotlin and
//   androidx.tracing classes (w63.m0 is androidx.tracing.Trace.truncatedTraceSectionLabel, not UtilitiesKt).
// Every row is matched whichever way S1 reads a field or descriptor that only has the type OkHttpClient, because each
// such reference sits in a method a row already covers.
import { ENTRY_POINT_HOOKS, LIBRARY_INTERNAL, NETWORK_SINKS, ONE_CLIENT_CLASSES } from "../../../tv-apk-dex-lists.mjs";

export const FIXTURE_ENTRY_POINTS = [
  {
    id: "FX1",
    classes: ["com.facebook.react.modules.network.OkHttpClientProvider"],
    sinks: ["S1"],
    what: "React Native's shared OkHttpClient, inlined into DevSupportHttpClient.<clinit> in the excerpt",
    reason: "Fixture row.",
    linkedPath: null,
  },
  {
    id: "FX2",
    classes: ["com.facebook.react.devsupport.inspector.DevSupportHttpClient"],
    sinks: ["S1"],
    what: "the dev-server inspector's two clients",
    reason: "Fixture row.",
    linkedPath: null,
  },
  {
    id: "FX3",
    classes: ["com.facebook.react.devsupport.CxxInspectorPackagerConnection$DelegateImpl"],
    sinks: ["S1"],
    what: "the inspector packager connection's web socket",
    reason: "Fixture row.",
    linkedPath: null,
  },
  {
    id: "FX4",
    classes: ["com.facebook.react.modules.network.NetworkingModule"],
    sinks: ["S1"],
    what: "React Native's Networking module",
    reason: "Fixture row.",
    linkedPath: null,
  },
  {
    id: "FX5",
    classes: ["expo.modules.filesystem.FileSystemDownloadKt"],
    sinks: ["S1"],
    what: "expo-file-system's download client",
    reason: "Fixture row.",
    linkedPath: null,
  },
];

export const FIXTURE_DEV_SUPPORT_CALLERS = [
  {
    class: "com.facebook.react.devsupport.CxxInspectorPackagerConnection$DelegateImpl",
    offInRelease: "Fixture row.",
  },
];

export const FIXTURE_LISTS = {
  sinks: NETWORK_SINKS,
  libraryInternal: LIBRARY_INTERNAL,
  oneClient: ONE_CLIENT_CLASSES,
  hooks: ENTRY_POINT_HOOKS,
  entryPoints: FIXTURE_ENTRY_POINTS,
  devSupportCallers: FIXTURE_DEV_SUPPORT_CALLERS,
  absentPackages: [],
};
