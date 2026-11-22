// Trims the release manifest and turns backup off (T3-22). It removes the Expo template's unused permissions and
// package-visibility queries from the main manifest, marks the ones expo-file-system also declares with
// tools:node="remove" so the manifest merger drops the library's copies, points the application at data extraction
// rules that exclude every domain from cloud backup and device-to-device transfer, and writes that rules file.
// android.allowBackup: false is set in app.config.ts, where Expo's withAllowBackup reads it.
// docs/specs/T3-22.md lists each removed entry and why Octave does not use it; docs/security.md §6 states the rule.
const fs = require("node:fs");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const TOOLS_NS = "http://schemas.android.com/tools";

// Declared only by the template's main manifest: dropped, no marker.
const TEMPLATE_ONLY_PERMISSIONS = ["android.permission.SYSTEM_ALERT_WINDOW", "android.permission.VIBRATE"];
// Declared by the template and by expo-file-system: dropped, and replaced by a tools:node="remove" marker.
const LIBRARY_PERMISSIONS = ["android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"];
const REMOVED_PERMISSIONS = [...TEMPLATE_ONLY_PERMISSIONS, ...LIBRARY_PERMISSIONS];

// Each query as the manifest merger keys it (action, category, data), and who declares it.
const REMOVED_QUERIES = [
  { key: "action:android.intent.action.VIEW+category:android.intent.category.BROWSABLE+data:scheme:https", declaredBy: "template" },
  { key: "action:android.intent.action.OPEN_DOCUMENT_TREE", declaredBy: "expo-file-system" },
  { key: "action:android.intent.action.VIEW+data:mimeType:*/*", declaredBy: "expo-file-system" },
];

// The remove markers for expo-file-system's two query intents, with the library's children in its order.
const QUERY_MARKERS = [
  { action: [{ $: { "android:name": "android.intent.action.OPEN_DOCUMENT_TREE" } }] },
  { action: [{ $: { "android:name": "android.intent.action.VIEW" } }], data: [{ $: { "android:mimeType": "*/*" } }] },
];

const RULES_NAME = "octave_data_extraction_rules";
const RULES_REFERENCE = `@xml/${RULES_NAME}`;
const DOMAINS = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"];
const excludes = DOMAINS.map((domain) => `    <exclude domain="${domain}" path="." />`).join("\n");

// Backup is off: every domain is excluded from both modes, and nothing is included.
const DATA_EXTRACTION_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by apps/tv/plugins/with-trimmed-manifest.js (T3-22). Backup is off: nothing Octave stores leaves the
     device through cloud backup or a device-to-device transfer. docs/security.md §6. -->
<data-extraction-rules>
  <cloud-backup>
${excludes}
  </cloud-backup>
  <device-transfer>
${excludes}
  </device-transfer>
</data-extraction-rules>
`;

const nameOf = (node) => node?.$?.["android:name"];
const isMarker = (node) => node?.$?.["tools:node"] === "remove";

const isHttpsView = (intent) => (intent.data ?? []).some((data) => data?.$?.["android:scheme"] === "https");
const sameIntent = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function trimManifest(manifest) {
  const root = manifest.manifest;
  root.$ = { ...root.$, "xmlns:tools": TOOLS_NS };

  const permissions = (root["uses-permission"] ?? []).filter((node) => {
    const name = nameOf(node);
    if (TEMPLATE_ONLY_PERMISSIONS.includes(name)) return false;
    return !(LIBRARY_PERMISSIONS.includes(name) && !isMarker(node));
  });
  for (const name of LIBRARY_PERMISSIONS) {
    if (!permissions.some((node) => nameOf(node) === name && isMarker(node))) {
      permissions.push({ $: { "android:name": name, "tools:node": "remove" } });
    }
  }
  root["uses-permission"] = permissions;

  const queries = (root.queries ?? []).map((element) => {
    const intents = (element.intent ?? []).filter((intent) => !isHttpsView(intent));
    return { ...element, intent: intents };
  });
  if (queries.length === 0) queries.push({ intent: [] });
  const target = queries[0];
  for (const children of QUERY_MARKERS) {
    const marker = { $: { "tools:node": "remove" }, ...children };
    if (!queries.some((element) => element.intent.some((intent) => sameIntent(intent, marker)))) target.intent.push(marker);
  }
  root.queries = queries;
  return manifest;
}

function setBackupRules(manifest) {
  const application = (manifest.manifest.application ?? [])[0];
  if (!application) throw new Error("with-trimmed-manifest: the main manifest has no <application>");
  application.$ = { ...application.$, "android:dataExtractionRules": RULES_REFERENCE };
  return manifest;
}

function withTrimmedManifest(config) {
  config = withAndroidManifest(config, (c) => {
    c.modResults = setBackupRules(trimManifest(c.modResults));
    return c;
  });
  return withDangerousMod(config, [
    "android",
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${RULES_NAME}.xml`), DATA_EXTRACTION_RULES_XML);
      return c;
    },
  ]);
}

module.exports = withTrimmedManifest;
module.exports.trimManifest = trimManifest;
module.exports.setBackupRules = setBackupRules;
module.exports.DATA_EXTRACTION_RULES_XML = DATA_EXTRACTION_RULES_XML;
module.exports.REMOVED_PERMISSIONS = REMOVED_PERMISSIONS;
module.exports.REMOVED_QUERIES = REMOVED_QUERIES;
