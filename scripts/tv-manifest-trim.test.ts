// @vitest-environment node
// T3-22 acceptance items 1 and 3, the config plugin's half: apps/tv/plugins/with-trimmed-manifest.js removes the Expo
// template's unused permissions and package-visibility queries from the main manifest, points the application at
// data extraction rules that exclude every domain, and apps/tv/app.config.ts turns backup off
// (docs/specs/T3-22.md, Acceptance and Test plan).
//
// Shapes this file freezes:
// - trimManifest(manifest) and setBackupRules(manifest) take the object Expo's withAndroidManifest gives a plugin
//   (xml2js: { manifest: { $: {...}, "uses-permission": [{ $: {...} }], queries: [{ intent: [...] }],
//   application: [{ $: {...}, activity: [...] }] } }) and return the manifest. The tests use the returned value.
// - REMOVED_PERMISSIONS is an array of the four permission names; REMOVED_QUERIES an array of three entries, one per
//   query, in any shape that names it.
// - DATA_EXTRACTION_RULES_XML is the rules file's text.
//
// Not frozen: the form of the two query remove-markers (milestone 2 settles it), and the spelling of an exclude's
// `path`. The plugin is loaded at run time from a path built here, so `pnpm typecheck` does not depend on it.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(repo, "apps", "tv");
const PLUGIN_PATH = join(app, "plugins", "with-trimmed-manifest.js");
const PLUGIN_ENTRY = "./plugins/with-trimmed-manifest.js";
const require = createRequire(import.meta.url);

const ANDROID_NS = "http://schemas.android.com/apk/res/android";
const TOOLS_NS = "http://schemas.android.com/tools";

type Attributes = Record<string, string>;
type Node = { $?: Attributes; [child: string]: unknown };
type Manifest = { manifest: Node };
type TrimmedManifestPlugin = ((config: unknown) => unknown) & {
  trimManifest: (manifest: Manifest) => Manifest;
  setBackupRules: (manifest: Manifest) => Manifest;
  DATA_EXTRACTION_RULES_XML: string;
  REMOVED_PERMISSIONS: string[];
  REMOVED_QUERIES: unknown[];
};

function loadPlugin(): TrimmedManifestPlugin {
  expect(existsSync(PLUGIN_PATH), "apps/tv/plugins/with-trimmed-manifest.js exists").toBe(true);
  return require(PLUGIN_PATH) as TrimmedManifestPlugin;
}

const SYSTEM_ALERT_WINDOW = "android.permission.SYSTEM_ALERT_WINDOW";
const VIBRATE = "android.permission.VIBRATE";
const READ_EXTERNAL_STORAGE = "android.permission.READ_EXTERNAL_STORAGE";
const WRITE_EXTERNAL_STORAGE = "android.permission.WRITE_EXTERNAL_STORAGE";
const INTERNET = "android.permission.INTERNET";

// The Expo SDK 58 template's main manifest (template.tgz in expo@58.0.26, android/app/src/main/AndroidManifest.xml)
// in the shape xml2js gives Expo, before any plugin. The tools namespace is left off so the test sees the plugin add it.
function templateManifest(): Manifest {
  return {
    manifest: {
      $: { "xmlns:android": ANDROID_NS },
      "uses-permission": [
        { $: { "android:name": INTERNET } },
        { $: { "android:name": SYSTEM_ALERT_WINDOW } },
        { $: { "android:name": VIBRATE } },
        { $: { "android:name": READ_EXTERNAL_STORAGE, "android:maxSdkVersion": "32", "tools:replace": "android:maxSdkVersion" } },
        { $: { "android:name": WRITE_EXTERNAL_STORAGE, "android:maxSdkVersion": "32", "tools:replace": "android:maxSdkVersion" } },
      ],
      queries: [
        {
          intent: [
            {
              action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
              category: [{ $: { "android:name": "android.intent.category.BROWSABLE" } }],
              data: [{ $: { "android:scheme": "https" } }],
            },
          ],
        },
      ],
      application: [
        {
          $: {
            "android:name": ".MainApplication",
            "android:label": "@string/app_name",
            "android:icon": "@mipmap/ic_launcher",
            "android:roundIcon": "@mipmap/ic_launcher_round",
            "android:allowBackup": "false",
            "android:theme": "@style/AppTheme",
            "android:supportsRtl": "true",
          },
          activity: [
            {
              $: {
                "android:name": ".MainActivity",
                "android:launchMode": "singleTask",
                "android:exported": "true",
              },
              "intent-filter": [
                {
                  action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
                  category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

const children = (node: Node | undefined, name: string): Node[] => {
  const value = node?.[name];
  return Array.isArray(value) ? (value as Node[]) : [];
};
const attr = (node: Node, name: string): string | undefined => node.$?.[name];
const marked = (node: Node) => attr(node, "tools:node") === "remove";

const permissionsNamed = (manifest: Manifest, name: string) =>
  children(manifest.manifest, "uses-permission").filter((node) => attr(node, "android:name") === name);

// Every intent that is not a remove marker, under every <queries> that is not one either.
function plainQueryIntents(manifest: Manifest): Node[] {
  return children(manifest.manifest, "queries")
    .filter((queries) => !marked(queries))
    .flatMap((queries) => children(queries, "intent"))
    .filter((intent) => !marked(intent));
}

const isHttpsView = (intent: Node) => children(intent, "data").some((data) => attr(data, "android:scheme") === "https");

// Expo's resolved config, as scripts/tv-app.test.ts reads it; one run serves every test that needs it.
const EXPO_TIMEOUT = 60_000;
type ExpoConfig = { android?: { allowBackup?: unknown }; plugins?: (string | [string, unknown?])[] };
let resolvedConfig: ExpoConfig | undefined;
function expoConfig(): ExpoConfig {
  if (resolvedConfig) return resolvedConfig;
  const child = spawnSync("pnpm", ["exec", "expo", "config", "--json"], {
    cwd: app,
    encoding: "utf8",
    timeout: EXPO_TIMEOUT,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1", CI: "1" },
  });
  expect(child.error, `expo config could not start: ${child.error?.message}`).toBeUndefined();
  expect(child.status, `expo config failed:\n${child.stdout}\n${child.stderr}`).toBe(0);
  const out = child.stdout;
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  expect(start, `expo config printed no JSON:\n${out}`).toBeGreaterThan(-1);
  resolvedConfig = JSON.parse(out.slice(start, end + 1)) as ExpoConfig;
  return resolvedConfig;
}

describe("trimManifest", () => {
  it("T3-22 item 1: leaves no declaration of SYSTEM_ALERT_WINDOW or VIBRATE, which only the template declares", () => {
    const { trimManifest } = loadPlugin();
    const out = trimManifest(templateManifest());
    expect(permissionsNamed(out, SYSTEM_ALERT_WINDOW)).toEqual([]);
    expect(permissionsNamed(out, VIBRATE)).toEqual([]);
  });

  it.each([READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE])(
    "T3-22 item 1: replaces %s with one tools:node=\"remove\" marker, since expo-file-system declares it too",
    (name) => {
      const { trimManifest } = loadPlugin();
      const entries = permissionsNamed(trimManifest(templateManifest()), name);
      expect(entries, `one uses-permission names ${name}`).toHaveLength(1);
      expect(attr(entries[0], "tools:node")).toBe("remove");
    },
  );

  it("T3-22 item 1: declares the tools namespace the markers need", () => {
    const { trimManifest } = loadPlugin();
    expect(attr(trimManifest(templateManifest()).manifest, "xmlns:tools")).toBe(TOOLS_NS);
  });

  it("T3-22 item 1: drops the template's https VIEW query and declares no query of its own", () => {
    const { trimManifest } = loadPlugin();
    const out = trimManifest(templateManifest());
    const intents = children(out.manifest, "queries").flatMap((queries) => children(queries, "intent"));
    expect(intents.filter(isHttpsView), "no https VIEW intent, marked or not").toEqual([]);
    expect(plainQueryIntents(out), "every intent left under <queries> is a remove marker").toEqual([]);
  });

  it("T3-22 item 1: keeps INTERNET as a plain permission, and the application and launcher activity as they were", () => {
    const { trimManifest } = loadPlugin();
    const before = templateManifest();
    const out = trimManifest(templateManifest());
    const internet = permissionsNamed(out, INTERNET);
    expect(internet).toHaveLength(1);
    expect(marked(internet[0])).toBe(false);
    expect(out.manifest.application).toEqual(before.manifest.application);
  });

  it("T3-22 item 1: gives the same manifest when applied twice", () => {
    const { trimManifest } = loadPlugin();
    const once = trimManifest(templateManifest());
    const twice = trimManifest(structuredClone(once));
    expect(twice).toEqual(once);
  });

  it("T3-22 item 1: adds no second storage marker to a manifest that already holds one", () => {
    const { trimManifest } = loadPlugin();
    const input = templateManifest();
    const permissions = children(input.manifest, "uses-permission").filter((node) => attr(node, "android:name") !== READ_EXTERNAL_STORAGE);
    permissions.push({ $: { "android:name": READ_EXTERNAL_STORAGE, "tools:node": "remove" } });
    input.manifest["uses-permission"] = permissions;
    input.manifest.$ = { ...input.manifest.$, "xmlns:tools": TOOLS_NS };
    const entries = permissionsNamed(trimManifest(input), READ_EXTERNAL_STORAGE);
    expect(entries).toHaveLength(1);
    expect(attr(entries[0], "tools:node")).toBe("remove");
  });

  it("T3-22 item 1: does not throw on a manifest without <queries>, and declares no query in it", () => {
    const { trimManifest } = loadPlugin();
    const input = templateManifest();
    delete input.manifest.queries;
    let out: Manifest | undefined;
    expect(() => {
      out = trimManifest(input);
    }).not.toThrow();
    expect(plainQueryIntents(out as Manifest)).toEqual([]);
    expect(permissionsNamed(out as Manifest, SYSTEM_ALERT_WINDOW)).toEqual([]);
  });

  it("T3-22 item 1: REMOVED_PERMISSIONS names the four permissions and REMOVED_QUERIES the three queries", () => {
    const { REMOVED_PERMISSIONS, REMOVED_QUERIES } = loadPlugin();
    expect([...REMOVED_PERMISSIONS].sort()).toEqual([READ_EXTERNAL_STORAGE, SYSTEM_ALERT_WINDOW, VIBRATE, WRITE_EXTERNAL_STORAGE].sort());
    expect(REMOVED_QUERIES).toHaveLength(3);
    const texts = REMOVED_QUERIES.map((entry) => JSON.stringify(entry));
    for (const token of ["https", "OPEN_DOCUMENT_TREE", "*/*"]) {
      expect(texts.filter((text) => text.includes(token)), `one REMOVED_QUERIES entry names ${token}`).toHaveLength(1);
    }
  });

  it(
    "T3-22 item 1: Expo's resolved config lists the plugin",
    () => {
      loadPlugin();
      const plugins = expoConfig().plugins ?? [];
      const names = plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
      expect(names).toContain(PLUGIN_ENTRY);
    },
    EXPO_TIMEOUT + 30_000,
  );
});

const DOMAINS = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"];

// The text of one <name>…</name> section, comments removed; undefined when absent.
function section(xml: string, name: string): string | undefined {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  return new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(text)?.[1];
}

describe("backup rules", () => {
  it("T3-22 item 3: setBackupRules points the main application at the rules file and changes nothing else", () => {
    const { setBackupRules } = loadPlugin();
    const before = templateManifest();
    const out = setBackupRules(templateManifest());
    const application = children(out.manifest, "application")[0];
    expect(attr(application, "android:dataExtractionRules")).toBe("@xml/octave_data_extraction_rules");
    const { "android:dataExtractionRules": _set, ...rest } = application.$ ?? {};
    expect(rest).toEqual(children(before.manifest, "application")[0].$);
    expect({ ...out.manifest, application: undefined }).toEqual({ ...before.manifest, application: undefined });
    expect({ ...application, $: undefined }).toEqual({ ...children(before.manifest, "application")[0], $: undefined });
  });

  it("T3-22 item 3: DATA_EXTRACTION_RULES_XML has a cloud-backup and a device-transfer section, each excluding all nine domains", () => {
    const { DATA_EXTRACTION_RULES_XML } = loadPlugin();
    expect(DATA_EXTRACTION_RULES_XML).toMatch(/<data-extraction-rules\b/);
    for (const name of ["cloud-backup", "device-transfer"]) {
      const body = section(DATA_EXTRACTION_RULES_XML, name);
      expect(body, `a <${name}> section`).toBeDefined();
      for (const domain of DOMAINS) {
        expect(body, `<${name}> excludes the ${domain} domain`).toMatch(new RegExp(`<exclude\\b[^>]*\\bdomain="${domain}"`));
      }
    }
  });

  it("T3-22 item 3: DATA_EXTRACTION_RULES_XML includes nothing", () => {
    const { DATA_EXTRACTION_RULES_XML } = loadPlugin();
    expect(DATA_EXTRACTION_RULES_XML).not.toContain("<include");
  });

  it(
    "T3-22 item 3: Expo's resolved config turns backup off",
    () => {
      expect(expoConfig().android?.allowBackup).toBe(false);
    },
    EXPO_TIMEOUT + 30_000,
  );
});
