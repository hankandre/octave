// @vitest-environment node
// T3-22, not frozen (the implementer's tests; docs/specs/T3-22.md, Test plan and spec check notes 2 and 5):
// - the query remove-markers in the form the release build proved (milestone 2: the merged manifest's <queries> is
//   empty and the merger report names both intents);
// - the plugin's DATA_EXTRACTION_RULES_XML passes judgeBackup, so the plugin's file and the check cannot drift apart;
// - checkManifest passes the three recorded dumps of the milestone-2 release APK (aapt2 2.20, build-tools 37.0.0):
//   the manifest, the resource table's xml block, and the rules file it resolves to (res/yB.xml);
// - judgeBackup refuses android:backupAgent and android:fullBackupOnly.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkManifest,
  judgeBackup,
  judgeManifestSurface,
  parseXmlTree,
  resolveResourceFile,
  type BackupFacts,
  type XmlElement,
} from "./tv-apk-manifest.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string) => readFileSync(join(repo, "scripts", "fixtures", "tv", name), "utf8");
const MANIFEST_AFTER = fixture("manifest-surface-after.txt");
const RESOURCES_AFTER = fixture("resources-xml-after.txt");
const RULES_AFTER = fixture("backup-rules-after.txt");
const RULES_FILE = "res/yB.xml";

type Node = { $?: Record<string, string>; [child: string]: unknown };
type Manifest = { manifest: Node };
const plugin = createRequire(import.meta.url)(join(repo, "apps", "tv", "plugins", "with-trimmed-manifest.js")) as {
  trimManifest: (manifest: Manifest) => Manifest;
  DATA_EXTRACTION_RULES_XML: string;
};

// Reads the plugin's rules XML (elements and attributes only) into the check's tree shape.
function parseRulesXml(xml: string): XmlElement {
  const text = xml.replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const root: XmlElement = { name: "#document", attributes: {}, children: [] };
  const stack = [root];
  for (const match of text.matchAll(/<(\/?)([\w-]+)([^>]*?)(\/?)>/g)) {
    const [, closing, name, attributeText, selfClosing] = match;
    if (closing) {
      stack.pop();
      continue;
    }
    const attributes = Object.fromEntries([...attributeText.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    const element: XmlElement = { name, attributes, children: [] };
    stack[stack.length - 1].children.push(element);
    if (!selfClosing) stack.push(element);
  }
  return root.children[0];
}

const facts = (overrides: Partial<BackupFacts> = {}): BackupFacts => ({
  allowBackup: false,
  fullBackupContent: null,
  rulesAttribute: "@0x7f130005",
  rulesFile: RULES_FILE,
  rulesTree: parseRulesXml(plugin.DATA_EXTRACTION_RULES_XML),
  ...overrides,
});

describe("the query remove-markers the release build proved", () => {
  it("T3-22 extra: marks expo-file-system's two query intents with its children, in its order", () => {
    const out = plugin.trimManifest({ manifest: { $: {}, queries: [{ intent: [] }] } });
    const intents = (out.manifest.queries as { intent: Node[] }[]).flatMap((queries) => queries.intent);
    expect(intents).toEqual([
      { $: { "tools:node": "remove" }, action: [{ $: { "android:name": "android.intent.action.OPEN_DOCUMENT_TREE" } }] },
      {
        $: { "tools:node": "remove" },
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        data: [{ $: { "android:mimeType": "*/*" } }],
      },
    ]);
  });
});

describe("the plugin's rules file and the check agree", () => {
  it("T3-22 extra: DATA_EXTRACTION_RULES_XML passes judgeBackup", () => {
    expect(judgeBackup(facts())).toEqual([]);
  });

  it("T3-22 extra: the rules file recorded from the release APK is the plugin's file", () => {
    expect(parseXmlTree(RULES_AFTER, "no-namespace")).toEqual(parseRulesXml(plugin.DATA_EXTRACTION_RULES_XML));
  });
});

describe("checkManifest on the recorded dumps of the release APK", () => {
  const dump = (...args: string[]) => {
    if (args[0] === "resources") return RESOURCES_AFTER;
    if (args[0] === "xmltree" && args.includes("AndroidManifest.xml")) return MANIFEST_AFTER;
    if (args[0] === "xmltree" && args.includes(RULES_FILE)) return RULES_AFTER;
    throw new Error(`unexpected aapt2 dump ${args.join(" ")}`);
  };

  it("T3-22 extra: resolves the rules reference through the resource table to the shortened path", () => {
    expect(resolveResourceFile(RESOURCES_AFTER, "@0x7f130005")).toBe(RULES_FILE);
    expect(resolveResourceFile(RESOURCES_AFTER, "@0x7f13ffff")).toBeNull();
    expect(resolveResourceFile(RESOURCES_AFTER, "true")).toBeNull();
  });

  it("T3-22 extra: the trimmed manifest passes the surface check", () => {
    expect(judgeManifestSurface(MANIFEST_AFTER)).toEqual([]);
  });

  it("T3-22 extra: returns no error for the release APK", () => {
    expect(checkManifest(dump, "app-release.apk")).toEqual([]);
  });

  it("T3-22 extra: fails when the rules file the table names cannot be read", () => {
    const broken = (...args: string[]) => (args.includes(RULES_FILE) ? "" : dump(...args));
    const errors = checkManifest(broken, "app-release.apk");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR tv apk: .*res\/yB\.xml/);
  });
});

describe("checkManifest reads every backup attribute from the manifest dump", () => {
  const ALLOW = "A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false";
  const dump = (manifest: string) => (...args: string[]) => {
    if (args[0] === "resources") return RESOURCES_AFTER;
    if (args[0] === "xmltree" && args.includes("AndroidManifest.xml")) return manifest;
    if (args[0] === "xmltree" && args.includes(RULES_FILE)) return RULES_AFTER;
    throw new Error(`unexpected aapt2 dump ${args.join(" ")}`);
  };

  it.each([
    ["backupAgent", 'A: http://schemas.android.com/apk/res/android:backupAgent(0x0101027f)="dev.octave.tv.BackupAgent" (Raw: "dev.octave.tv.BackupAgent")'],
    ["fullBackupOnly", "A: http://schemas.android.com/apk/res/android:fullBackupOnly(0x01010473)=true"],
    ["fullBackupContent", "A: http://schemas.android.com/apk/res/android:fullBackupContent(0x01010473)=@0x7f130006"],
  ])("T3-22 extra: fails a recorded manifest that also declares android:%s", (name, line) => {
    expect(MANIFEST_AFTER).toContain(ALLOW);
    const manifest = MANIFEST_AFTER.replace(ALLOW, `${ALLOW}\n        ${line}`);
    const errors = checkManifest(dump(manifest), "app-release.apk");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(new RegExp(`^ERROR tv apk: android:${name}`));
  });
});

describe("judgeBackup refuses backup settings that take no effect today", () => {
  it.each([
    ["backupAgent", { backupAgent: "dev.octave.tv.BackupAgent" }],
    ["fullBackupOnly", { fullBackupOnly: "true" }],
  ])("T3-22 extra: refuses android:%s", (name, override) => {
    const errors = judgeBackup(facts(override));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(new RegExp(`^ERROR tv apk: android:${name}`));
  });
});
