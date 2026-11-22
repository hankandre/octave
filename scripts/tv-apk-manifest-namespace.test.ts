// @vitest-environment node
// T3-23 acceptance items 1, 2 and 5 (docs/specs/T3-23.md): scripts/tv-apk-manifest.mjs reads each attribute of the
// release manifest the way Android reads it (by framework resource id) and each attribute of the data extraction
// rules file with no namespace, and an element with two attributes of one local name is an error.
//
// Every case is the recorded dump of a release APK with lines inserted or replaced, run through the two functions
// both code bases export: judgeManifestSurface(text) and checkManifest(dump, apk). Line forms follow aapt2's
// XmlPrinter (tools/aapt2/Debug.cpp): `A: <namespace>:<name>(0x<id>)=<value>`, the id only on an attribute that has one.
// The duplicate line is matched by its fixed phrase, `<element> (line=N) has two attributes named <name>`, so
// that the value line a single attribute already produces cannot satisfy it.
// The three recorded dumps are frozen with this file: an edit to one could turn a test green.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const fixture = (name: string) => read(join("scripts", "fixtures", "tv", name));
const MANIFEST = fixture("manifest-surface-after.txt");
const RESOURCES = fixture("resources-xml-after.txt");
const RULES = fixture("backup-rules-after.txt");
const RULES_FILE = "res/yB.xml";

type Check = {
  judgeManifestSurface: (text: string) => string[];
  checkManifest: (dump: (...args: string[]) => string, apk?: string) => string[];
};
async function load(): Promise<Check> {
  return (await import("./tv-apk-manifest.mjs")) as unknown as Check;
}

const ANDROID = "http://schemas.android.com/apk/res/android";
const PRIVATE = "http://schemas.android.com/apk/prv/res/android";
const OTHER = "http://example.com/x";

// One attribute line, quoted with its Raw copy for a string; `id` only when the attribute has a framework id.
const text = (namespace: string | null, name: string, value: string, id?: string) =>
  `A: ${namespace ? `${namespace}:` : ""}${name}${id ? `(${id})` : ""}="${value}" (Raw: "${value}")`;
const android = (name: string, value: string, id: string) => text(ANDROID, name, value, id);
const other = (name: string, value: string) => text(OTHER, name, value);
const none = (name: string, value: string) => text(null, name, value);

const NAME_ID = "0x01010003";
const PERMISSION = (value: string) => android("name", value, NAME_ID);
const CAMERA = "android.permission.CAMERA";
const INTERNET = "android.permission.INTERNET";

const ALLOW = `A: ${ANDROID}:allowBackup(0x01010280)=false`;
const ALLOW_TRUE = `A: ${ANDROID}:allowBackup(0x01010280)=true`;
// aapt2's printed form for an attribute without an id is not settled (spec, "Unverified"): both are written.
const ALLOW_OTHER = [`A: ${OTHER}:allowBackup="false" (Raw: "false")`, `A: ${OTHER}:allowBackup=false`];
const ALLOW_NONE = [`A: allowBackup="false" (Raw: "false")`, `A: allowBackup=false`];

function replaceLine(source: string, anchor: string, replacement: string): string {
  expect(source, `the recorded dump holds the anchor line ${anchor}`).toContain(anchor);
  return source.replace(anchor, replacement);
}

// A new <uses-permission> before <application>, with the given attribute lines.
const APPLICATION = "      E: application (line=32)";
const withPermission = (...attributes: string[]) =>
  replaceLine(MANIFEST, APPLICATION, ["      E: uses-permission (line=40)", ...attributes.map((a) => `        ${a}`), APPLICATION].join("\n"));

// The manifest with the application's allowBackup line replaced by the given lines.
const withAllowBackup = (...lines: string[]) => replaceLine(MANIFEST, ALLOW, lines.map((l, i) => (i === 0 ? l : `        ${l}`)).join("\n"));

const dumpOf =
  (manifest: string, rules: string = RULES) =>
  (...args: string[]) => {
    if (args[0] === "resources") return RESOURCES;
    if (args[0] === "xmltree" && args.includes("AndroidManifest.xml")) return manifest;
    if (args[0] === "xmltree" && args.includes(RULES_FILE)) return rules;
    throw new Error(`unexpected aapt2 dump ${args.join(" ")}`);
  };

const duplicate = (element: string, name: string) => new RegExp(`${element} \\(line=\\d+\\) has two attributes named ${name}\\b`);
const matching = (errors: string[], pattern: RegExp) => errors.filter((line) => pattern.test(line));

// The cloud-backup section's sharedpref exclude, in the recorded rules file.
const SHARED_EXCLUDE = ['        E: exclude (line=9)', '          A: domain="sharedpref" (Raw: "sharedpref")', '          A: path="." (Raw: ".")'].join("\n");
const withSharedExclude = (...attributes: string[]) =>
  replaceLine(RULES, SHARED_EXCLUDE, ["        E: exclude (line=9)", ...attributes.map((a) => `          ${a}`)].join("\n"));

describe("T3-23 item 1: the two reproductions from T3-22's review fail", () => {
  it.each([
    ["another namespace", other("name", INTERNET)],
    ["no namespace", none("name", INTERNET)],
  ])("T3-23 item 1: a CAMERA uses-permission followed by a name in %s that is on the list fails", async (_label, second) => {
    const { judgeManifestSurface } = await load();
    const errors = judgeManifestSurface(withPermission(PERMISSION(CAMERA), second));
    expect(errors.some((line) => line.includes(CAMERA)), `an error names ${CAMERA}: ${JSON.stringify(errors)}`).toBe(true);
  });

  it.each([
    ["another namespace, quoted", ALLOW_OTHER[0]],
    ["another namespace, bare", ALLOW_OTHER[1]],
    ["no namespace, quoted", ALLOW_NONE[0]],
    ["no namespace, bare", ALLOW_NONE[1]],
  ])("T3-23 item 1: android:allowBackup=true followed by allowBackup=false in %s fails", async (_label, second) => {
    const { checkManifest } = await load();
    const errors = checkManifest(dumpOf(withAllowBackup(ALLOW_TRUE, second)), "app-release.apk");
    expect(errors.some((line) => /allowBackup/.test(line) && /true/.test(line)), `an error names allowBackup and true: ${JSON.stringify(errors)}`).toBe(true);
  });
});

describe("T3-23 item 2: attributes are read as Android reads them, and a duplicate is an error", () => {
  it.each([
    ["another namespace", other("name", INTERNET)],
    ["no namespace", none("name", INTERNET)],
  ])("T3-23 item 2: a uses-permission with android:name and a second name in %s names the element and the attribute, in either order", async (_label, second) => {
    const { judgeManifestSurface } = await load();
    for (const attributes of [[PERMISSION(CAMERA), second], [second, PERMISSION(CAMERA)]]) {
      const errors = judgeManifestSurface(withPermission(...attributes));
      expect(matching(errors, duplicate("uses-permission", "name")), JSON.stringify(errors)).toHaveLength(1);
    }
  });

  it.each([
    ["another namespace, quoted", ALLOW_OTHER[0]],
    ["another namespace, bare", ALLOW_OTHER[1]],
    ["no namespace, quoted", ALLOW_NONE[0]],
    ["no namespace, bare", ALLOW_NONE[1]],
  ])("T3-23 item 2: an application with android:allowBackup and a second one in %s names the element and the attribute once, in either order", async (_label, second) => {
    const { checkManifest } = await load();
    for (const lines of [[ALLOW_TRUE, second], [second, ALLOW_TRUE], [ALLOW, second]]) {
      const errors = checkManifest(dumpOf(withAllowBackup(...lines)), "app-release.apk");
      expect(matching(errors, duplicate("application", "allowBackup")), JSON.stringify(errors)).toHaveLength(1);
    }
  });

  it("T3-23 item 2: a benign pair, android:name INTERNET and a second INTERNET name in another namespace, still fails", async () => {
    const { judgeManifestSurface } = await load();
    const errors = judgeManifestSurface(withPermission(PERMISSION(INTERNET), other("name", INTERNET)));
    expect(matching(errors, duplicate("uses-permission", "name")), JSON.stringify(errors)).toHaveLength(1);
  });

  it.each([
    ["another namespace", other("name", INTERNET)],
    ["no namespace", none("name", INTERNET)],
  ])("T3-23 item 2: a uses-permission whose only name is in %s is read as having no name and fails", async (_label, only) => {
    const { judgeManifestSurface } = await load();
    const errors = judgeManifestSurface(withPermission(only));
    expect(errors.length, "Android reads no name, so the permission is off the list").toBeGreaterThan(0);
    expect(errors.some((line) => /uses-permission/.test(line))).toBe(true);
  });

  it.each([
    ["another namespace, quoted", ALLOW_OTHER[0]],
    ["another namespace, bare", ALLOW_OTHER[1]],
    ["no namespace, quoted", ALLOW_NONE[0]],
    ["no namespace, bare", ALLOW_NONE[1]],
  ])("T3-23 item 2: an application whose only allowBackup is in %s is read as absent, which is true, and fails", async (_label, only) => {
    const { checkManifest } = await load();
    const errors = checkManifest(dumpOf(withAllowBackup(only)), "app-release.apk");
    expect(errors.some((line) => /allowBackup/.test(line)), JSON.stringify(errors)).toBe(true);
  });

  it("T3-23 item 2: android:backupAgent in the private android namespace, which carries a framework id, fails", async () => {
    const { checkManifest } = await load();
    const line = `A: ${PRIVATE}:backupAgent(0x0101027f)="dev.octave.tv.BackupAgent" (Raw: "dev.octave.tv.BackupAgent")`;
    const errors = checkManifest(dumpOf(replaceLine(MANIFEST, ALLOW, `${ALLOW}\n        ${line}`)), "app-release.apk");
    expect(errors.some((error) => /backupAgent/.test(error)), JSON.stringify(errors)).toBe(true);
  });

  it("T3-23 item 2: a rules-file exclude whose domain and path are in a namespace does not count and fails", async () => {
    const { checkManifest } = await load();
    const rules = withSharedExclude(other("domain", "sharedpref"), other("path", "."));
    const errors = checkManifest(dumpOf(MANIFEST, rules), "app-release.apk");
    expect(errors.some((line) => /whole sharedpref domain/.test(line)), JSON.stringify(errors)).toBe(true);
  });

  it.each([
    ["no-namespace partial path first", [none("path", "octave_secret.xml"), other("path", ".")]],
    ["namespaced path of . first", [other("path", "."), none("path", "octave_secret.xml")]],
  ])("T3-23 item 2: a rules-file exclude with a second path (%s) names the element and the attribute and reports the partial exclude", async (_label, paths) => {
    const { checkManifest } = await load();
    const rules = withSharedExclude(none("domain", "sharedpref"), ...paths);
    const errors = checkManifest(dumpOf(MANIFEST, rules), "app-release.apk");
    expect(matching(errors, duplicate("exclude", "path")), JSON.stringify(errors)).toHaveLength(1);
    expect(errors.some((line) => /octave_secret\.xml/.test(line) && /sharedpref/.test(line)), `the partial exclude is reported: ${JSON.stringify(errors)}`).toBe(true);
  });

  it("T3-23 item 2: a rules-file exclude with a second no-namespace path fails and names the element and the attribute", async () => {
    const { checkManifest } = await load();
    const rules = withSharedExclude(none("domain", "sharedpref"), none("path", "octave_secret.xml"), none("path", "."));
    const errors = checkManifest(dumpOf(MANIFEST, rules), "app-release.apk");
    expect(matching(errors, duplicate("exclude", "path")), JSON.stringify(errors)).toHaveLength(1);
  });

  it("T3-23 item 2: the untouched recorded dumps still pass", async () => {
    const { judgeManifestSurface, checkManifest } = await load();
    expect(judgeManifestSurface(MANIFEST)).toEqual([]);
    expect(checkManifest(dumpOf(MANIFEST), "app-release.apk")).toEqual([]);
  });
});

function releaseManifestSection(): string {
  const lines = read("docs/security.md").split("\n");
  const start = lines.findIndex((line) => /^## 6\. The release manifest\s*$/.test(line));
  expect(start, "docs/security.md has a section `## 6. The release manifest`").toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

describe("T3-23 item 5: docs/security.md section 6 says how the check reads attributes", () => {
  it("T3-23 item 5: section 6 names the resource id rule, the no-namespace rule, the duplicate rule and this test", () => {
    const section = releaseManifestSection();
    for (const needle of ["resource id", "no namespace", "two attributes", "scripts/tv-apk-manifest-namespace.test.ts"]) {
      expect(section, `section 6 names ${needle}`).toContain(needle);
    }
  });

  it("T3-23 item 5: the two sentences that stated on-device backup behaviour as fact are reworded and marked Planned", () => {
    const section = releaseManifestSection();
    expect(section).not.toContain("none of its data leaves the device through Android backup or a device-to-device transfer");
    expect(section).not.toContain("No preference is backed up, so no credential");
    expect(section).toContain("**Tested**");
    expect(section).toContain("**Planned (T4-05, T4-09)**");
  });
});
