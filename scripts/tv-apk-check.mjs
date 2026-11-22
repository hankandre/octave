// Checks the TV release APK's badging (T3-01 item 3): Octave's application ID, arm64-v8a native code, a leanback
// launchable activity, and a touchscreen that is declared not required. Then its network security (T3-15): the
// manifest names a configuration whose only content is one base-config that permits cleartext, read from the APK
// itself through the resource table, never by a guessed path.
// Run: node scripts/tv-apk-check.mjs [apk]   (pnpm tv:apk:check)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity.ts";
import { parseXmlTree, readXmlTree, resolveResourceFile } from "./tv-aapt2-xml.mjs";
import { androidSdk, newestBuildTool } from "./tv-android-sdk.mjs";

export { parseXmlTree, readXmlTree, resolveResourceFile };

export const RELEASE_APK = fileURLToPath(new URL("../apps/tv/android/app/build/outputs/apk/release/app-release.apk", import.meta.url));

const TOUCHSCREEN = "android.hardware.touchscreen";

// Returns one `ERROR tv apk: ...` line per missing fact; empty when the badging passes.
export function checkBadging(text) {
  const lines = text.split("\n").map((line) => line.trim());
  const errors = [];
  const fail = (problem) => errors.push(`ERROR tv apk: ${problem}`);

  const pkg = lines.find((line) => line.startsWith("package: "));
  const name = pkg ? /name='([^']*)'/.exec(pkg)?.[1] : undefined;
  if (name !== ANDROID_APPLICATION_ID) {
    fail(name === undefined ? `no package line; expected ${ANDROID_APPLICATION_ID}` : `the package is ${name}, not ${ANDROID_APPLICATION_ID}`);
  }

  const nativeCode = lines.find((line) => line.startsWith("native-code: "));
  if (!nativeCode?.includes("'arm64-v8a'")) {
    fail(nativeCode === undefined ? "no native code; expected arm64-v8a" : `the native code lacks arm64-v8a (${nativeCode})`);
  }

  if (!lines.some((line) => line.startsWith("leanback-launchable-activity: "))) {
    fail("no leanback-launchable-activity; the main activity needs the LEANBACK_LAUNCHER category");
  }

  const notRequired = lines.includes(`uses-feature-not-required: name='${TOUCHSCREEN}'`);
  const required = lines.some((line) => line === `uses-feature: name='${TOUCHSCREEN}'` || line.startsWith(`uses-implied-feature: name='${TOUCHSCREEN}'`));
  if (!notRequired || required) fail(`the APK requires ${TOUCHSCREEN}; declare it with android:required="false"`);

  return errors;
}

// --- Network security (T3-15) ------------------------------------------------------------------------------------

// The application element's networkSecurityConfig value (a resource reference) and usesCleartextTraffic, from the
// manifest's xmltree text.
// The manifest is read in "manifest" mode: Android finds its attributes by framework resource id. `problems` holds the
// duplicate-attribute lines the reader recorded; judgeNetworkSecurity turns them into errors.
export function readManifestNetworkSecurity(text) {
  const { tree: manifest, problems } = readXmlTree(text, "manifest");
  const application = manifest?.children.find((child) => child.name === "application");
  const attributes = application?.attributes ?? {};
  const uses = attributes.usesCleartextTraffic;
  return {
    configAttribute: attributes.networkSecurityConfig ?? null,
    usesCleartextTraffic: uses === undefined ? null : uses === "true",
    problems,
  };
}

const NETWORK_SECURITY_ROOT = "network-security-config";

// Returns `ERROR tv apk: ...` lines; empty only when the manifest names a configuration file whose tree is
// network-security-config holding exactly one base-config, with exactly the one attribute cleartextTrafficPermitted
// set to true and no children. usesCleartextTraffic is neither required nor refused: Android ignores it once a
// configuration is present, and the debug overlay sets it.
export function judgeNetworkSecurity(facts) {
  const errors = [];
  const fail = (problem) => errors.push(`ERROR tv apk: ${problem}`);
  // An element with two attributes of one local name is an error, so a second value cannot hide behind the first.
  for (const problem of facts.problems ?? []) fail(problem);
  if (facts.configAttribute === null) {
    const only = facts.usesCleartextTraffic === true ? " (usesCleartextTraffic alone is ignored from API 38 and is not the configuration)" : "";
    fail(`the manifest's application has no networkSecurityConfig attribute${only}`);
    return errors;
  }
  if (facts.configFile === null) {
    fail(`networkSecurityConfig ${facts.configAttribute} does not resolve to one file in the resource table`);
    return errors;
  }
  const tree = facts.tree;
  if (tree === null) {
    fail(`the networkSecurityConfig file ${facts.configFile} could not be read`);
    return errors;
  }
  if (tree.name !== NETWORK_SECURITY_ROOT) fail(`the configuration's root is ${tree.name}, not ${NETWORK_SECURITY_ROOT}`);
  for (const name of Object.keys(tree.attributes)) fail(`${NETWORK_SECURITY_ROOT} has an attribute ${name}; it takes none`);
  const bases = tree.children.filter((child) => child.name === "base-config");
  for (const child of tree.children) {
    if (child.name !== "base-config") fail(`the configuration holds ${child.name}; only one base-config is allowed, so HTTPS keeps the platform defaults`);
  }
  if (bases.length === 0) fail("the configuration has no base-config, so cleartext is not permitted app-wide");
  if (bases.length > 1) fail(`the configuration has ${bases.length} base-config elements; one is allowed`);
  const [base] = bases;
  if (base !== undefined) {
    const permitted = base.attributes.cleartextTrafficPermitted;
    if (permitted === undefined) fail("base-config does not set cleartextTrafficPermitted");
    else if (permitted !== "true") fail(`base-config has cleartextTrafficPermitted=${permitted}, not true`);
    for (const name of Object.keys(base.attributes)) {
      if (name !== "cleartextTrafficPermitted") fail(`base-config sets ${name}; only cleartextTrafficPermitted is allowed`);
    }
    for (const child of base.children) fail(`base-config holds ${child.name}; it holds nothing, so HTTPS keeps the platform defaults`);
  }
  return errors;
}

// Reads the network security facts of an APK with three aapt2 calls. Throws an Error naming the failed call.
export function readNetworkSecurity(aapt2, apk) {
  const dump = (...args) => {
    const child = spawnSync(aapt2, ["dump", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (child.status !== 0) throw new Error(`aapt2 dump ${args[0]} failed: ${(child.stderr || child.error?.message || "").trim()}`);
    return child.stdout;
  };
  const { configAttribute, usesCleartextTraffic, problems } = readManifestNetworkSecurity(dump("xmltree", apk, "--file", "AndroidManifest.xml"));
  const configFile = configAttribute === null ? null : resolveResourceFile(dump("resources", apk), configAttribute);
  // Android reads the configuration file by local name, in any namespace: "any-namespace" mode.
  const configRead = configFile === null ? { tree: null, problems: [] } : readXmlTree(dump("xmltree", apk, "--file", configFile), "any-namespace");
  return { configAttribute, configFile, usesCleartextTraffic, tree: configRead.tree, problems: [...problems, ...configRead.problems] };
}

function main(args) {
  const apk = args[0] ?? RELEASE_APK;
  if (!existsSync(apk)) {
    console.error(`ERROR tv apk: no APK at ${apk}; run pnpm tv:prebuild and pnpm tv:build first`);
    process.exit(1);
  }
  let aapt2;
  try {
    aapt2 = newestBuildTool(androidSdk(), "aapt2");
  } catch (error) {
    console.error(`ERROR tv apk: ${error.message}`);
    process.exit(1);
  }
  const child = spawnSync(aapt2, ["dump", "badging", apk], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (child.status !== 0) {
    console.error(`ERROR tv apk: aapt2 dump badging failed: ${(child.stderr || child.error?.message || "").trim()}`);
    process.exit(1);
  }
  const errors = checkBadging(child.stdout);
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
  console.log(`tv apk: ${apk} passes (arm64-v8a, leanback launcher, touchscreen not required)`);
  let facts;
  try {
    facts = readNetworkSecurity(aapt2, apk);
  } catch (error) {
    console.error(`ERROR tv apk: ${error.message}`);
    process.exit(1);
  }
  const network = judgeNetworkSecurity(facts);
  for (const error of network) console.error(error);
  if (network.length > 0) process.exit(1);
  console.log("tv apk: network security permits cleartext app-wide through one base-config, nothing else");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
