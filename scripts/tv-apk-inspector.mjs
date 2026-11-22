// The inspector check (T3-16 item 5, release_build_has_no_inspector; docs/specs/T3-16.md, "The inspector check").
// Fails when an APK holds Expo's network inspector wiring or a dev-launcher, dev-menu or network-addons package.
//
// Both Gradle plugins that install the inspector (expo-dev-launcher's DevLauncherPlugin and expo-network-addons'
// NetworkAddonsPlugin, decision 0005) inject bytecode into every OkHttpClient.Builder.build() that calls into
// expo.modules.kotlin.devtools, so a check on that package catches the wiring whichever plugin injected it.
//
// - N1. A dex carries an R8 marker with "compilation-mode":"release" and a pg-map-id, and no dex carries a marker with
//   "compilation-mode":"debug".
// - N2. The mapping exists and its `# pg_map_id:` equals the release marker's pg-map-id, so a mapping from another
//   build (the e2e build writes the same path) proves nothing.
// - N3. No class descriptor is in an inspector package.
// - N4. No line of the mapping names a class or member of an inspector package, as a class line or an inline frame.
//   R8 renames what it keeps, so this is what sees a renamed, merged or inlined survivor.
//
// Run: node scripts/tv-apk-inspector.mjs [apk] [mapping]. With no argument it reads the release APK and the release
// mapping; with an APK and no mapping it reads no mapping, so a debug APK alone fails on N1, N2 and N3.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { androidSdk, newestBuildTool } from "./tv-android-sdk.mjs";
import { RELEASE_APK } from "./tv-apk-check.mjs";
import { readZipEntries } from "./tv-zip.mjs";

export const RELEASE_MAPPING = fileURLToPath(new URL("../apps/tv/android/app/build/outputs/mapping/release/mapping.txt", import.meta.url));

// Read from expo/expo at e88ec73b49 (sdk-58): the interceptors and their CDP types, and the runtime packages of
// expo-dev-launcher, expo-dev-menu and expo-network-addons.
export const INSPECTOR_PACKAGES = ["expo.modules.kotlin.devtools", "expo.modules.devlauncher", "expo.modules.devmenu", "expo.modules.networkaddons"];

const MARKER = /~~([A-Z0-9]+)(\{[^{}\u0000]*\})/g;
const MAX_NAMED = 20;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The marker strings in a dex file's bytes (`~~R8{...}`, `~~D8{...}`), distinct, in order. */
export function readMarkers(dex) {
  const text = dex.toString("latin1");
  return [...new Set([...text.matchAll(MARKER)].map((match) => match[0]))];
}

function parseMarker(marker) {
  const match = /^~~([A-Z0-9]+)(\{.*\})$/.exec(marker);
  if (!match) return null;
  try {
    return { tool: match[1], fields: JSON.parse(match[2]) };
  } catch {
    return null;
  }
}

/** Judges an APK's facts; returns ERROR lines naming their rule, empty when it passes. */
export function judgeInspector({ descriptors, markers, mapping }) {
  const errors = [];
  const parsed = markers.map(parseMarker).filter((marker) => marker !== null);

  // N1
  const release = parsed.filter(
    (m) => m.tool === "R8" && m.fields["compilation-mode"] === "release" && typeof m.fields["pg-map-id"] === "string" && m.fields["pg-map-id"] !== "",
  );
  const debugCount = parsed.filter((m) => m.fields["compilation-mode"] === "debug").length;
  if (release.length === 0) errors.push('ERROR tv inspector: N1 no dex carries an R8 marker with "compilation-mode":"release" and a pg-map-id; this is not a minified release build');
  if (debugCount > 0) errors.push(`ERROR tv inspector: N1 ${debugCount} dex marker(s) say "compilation-mode":"debug"; a release APK holds no debug-compiled dex`);
  const mapIds = [...new Set(release.map((m) => m.fields["pg-map-id"]))];
  if (mapIds.length > 1) errors.push(`ERROR tv inspector: N1 the R8 markers name ${mapIds.length} different pg-map-ids`);

  // N2
  if (mapping === null) {
    errors.push("ERROR tv inspector: N2 no R8 mapping; without it a renamed inspector class cannot be seen");
  } else {
    const id = /^# pg_map_id: ([0-9a-f]+)\s*$/m.exec(mapping)?.[1];
    if (id === undefined) errors.push("ERROR tv inspector: N2 the mapping has no # pg_map_id line");
    else if (mapIds.length === 1 && id !== mapIds[0]) errors.push(`ERROR tv inspector: N2 the mapping's pg_map_id ${id} is not the APK's ${mapIds[0]}; it is from another build`);
  }

  // N3
  const prefixes = INSPECTOR_PACKAGES.map((name) => `L${name.replaceAll(".", "/")}/`);
  const kept = descriptors.filter((descriptor) => prefixes.some((prefix) => descriptor.startsWith(prefix)));
  for (const descriptor of kept.slice(0, MAX_NAMED)) {
    errors.push(`ERROR tv inspector: N3 the APK holds ${descriptor.slice(1, -1).replaceAll("/", ".")}, a class of an inspector package`);
  }
  if (kept.length > MAX_NAMED) errors.push(`ERROR tv inspector: N3 and ${kept.length - MAX_NAMED} more inspector classes`);

  // N4
  if (mapping !== null) {
    const names = new RegExp(`(?<![\\w$.])(?:${INSPECTOR_PACKAGES.map(escapeRegExp).join("|")})\\.[\\w$]`);
    const lines = mapping.split("\n");
    const hits = [];
    lines.forEach((line, index) => {
      if (names.test(line)) hits.push(`ERROR tv inspector: N4 mapping line ${index + 1} names an inspector package: ${line.trim().slice(0, 160)}`);
    });
    errors.push(...hits.slice(0, MAX_NAMED));
    if (hits.length > MAX_NAMED) errors.push(`ERROR tv inspector: N4 and ${hits.length - MAX_NAMED} more mapping lines`);
  }
  return errors;
}

/** Reads an APK's class descriptors with dexdump and its dex markers from the dex bytes. Throws on a failed read. */
export function readApkFacts(apk, dexdump) {
  const dexFiles = readZipEntries(apk, (name) => /^classes\d*\.dex$/.test(name));
  if (dexFiles.length === 0) throw new Error(`${apk} holds no classes.dex`);
  const child = spawnSync(dexdump, ["-f", apk], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
  if (child.status !== 0) throw new Error(`dexdump -f failed: ${(child.stderr || child.error?.message || "").trim().slice(0, 300)}`);
  const opened = (child.stdout.match(/^Opened '/gm) ?? []).length;
  if (opened !== dexFiles.length) throw new Error(`dexdump opened ${opened} dex files, the APK holds ${dexFiles.length}`);
  const descriptors = [...child.stdout.matchAll(/^\s*Class descriptor\s*:\s*'([^']+)'/gm)].map((match) => match[1]);
  if (descriptors.length === 0) throw new Error("dexdump listed no class descriptor");
  return { descriptors, markers: dexFiles.flatMap((dex) => readMarkers(dex.bytes)), dexCount: dexFiles.length };
}

export function main(args = process.argv.slice(2)) {
  const apk = args[0] ?? RELEASE_APK;
  const mappingPath = args.length === 0 ? RELEASE_MAPPING : (args[1] ?? null);
  if (!existsSync(apk)) {
    console.error(`ERROR tv inspector: no APK at ${apk}; run pnpm tv:prebuild and pnpm tv:build first`);
    return 1;
  }
  let facts;
  try {
    facts = readApkFacts(apk, newestBuildTool(androidSdk(), "dexdump"));
  } catch (error) {
    console.error(`ERROR tv inspector: ${error.message}`);
    return 1;
  }
  const mapping = mappingPath !== null && existsSync(mappingPath) ? readFileSync(mappingPath, "utf8") : null;
  const errors = judgeInspector({ descriptors: facts.descriptors, markers: facts.markers, mapping });
  for (const error of errors) console.error(error);
  if (errors.length > 0) return 1;
  console.log(
    `tv inspector: ${apk} passes (${facts.dexCount} dex, ${facts.descriptors.length} classes, R8 release with its mapping; no class of ${INSPECTOR_PACKAGES.join(", ")} kept or renamed)`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
