// @vitest-environment node
// T3-22 acceptance items 2, 3 and 5, the check's half: scripts/tv-apk-manifest.mjs reads the release APK's
// manifest with `aapt2 dump xmltree` and fails on any permission or package-visibility query outside its named
// lists, and on any backup setting other than "off" (docs/specs/T3-22.md, Acceptance and Test plan). `pnpm
// tv:apk:check` runs it after the badging check, so the tv job applies it to the release APK it builds.
//
// The fixture scripts/fixtures/tv/manifest-surface-before.txt is `aapt2 dump xmltree <apk> --file
// AndroidManifest.xml` (build-tools 37.0.0) of a release APK built before this task (a task/T3-02 build, whose
// manifest matches the spec's Facts): six uses-permission, one declared permission, three query intents,
// allowBackup=true and no data extraction rules.
//
// Shapes this file freezes (settled at the freeze; the spec leaves them open):
// - judgeManifestSurface(text) and judgeBackup(facts) return `ERROR tv apk: ...` lines, empty when they pass.
// - The tree shape is { name, attributes, children }: attribute names without namespace or resource id, quoted
//   values without quotes, other values as printed.
// - facts = { allowBackup, fullBackupContent, rulesAttribute, rulesFile, rulesTree }, null when absent:
//   allowBackup is a boolean (aapt2 prints it bare); fullBackupContent is false or the printed reference;
//   rulesAttribute is the printed reference (`@0x7f......`); rulesFile is the resolved path inside the APK, null
//   when the reference does not resolve; rulesTree is the rules file's tree, null when unread.
// - checkManifest(dump) calls dump(...args) for the text of `aapt2 dump <args>`; the fake below answers by the
//   first argument and by whether the arguments name AndroidManifest.xml, so it serves either call shape.
// - ALLOWED_PERMISSIONS and ALLOWED_DECLARED_PERMISSIONS are { name, reason }[]; ALLOWED_QUERIES is
//   { key, reason }[]. Their contents are not frozen, so a later task adds a row without a frozen-test ruling.
//
// Not frozen: error wording beyond the prefix and the entry's name, the `aapt2 dump resources` line shape, and the
// spelling of an exclude's `path` (read from the plugin's DATA_EXTRACTION_RULES_XML).
//
// The script and the plugin are loaded at run time from paths built here, so `pnpm typecheck` does not depend on
// them existing.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const SCRIPT = join(repo, "scripts", "tv-apk-manifest.mjs");
const FIXTURE = join(repo, "scripts", "fixtures", "tv", "manifest-surface-before.txt");
const BEFORE = readFileSync(FIXTURE, "utf8");

type XmlElement = { name: string; attributes: Record<string, string>; children: XmlElement[] };
type BackupFacts = {
  allowBackup: boolean | null;
  fullBackupContent: string | boolean | null;
  rulesAttribute: string | null;
  rulesFile: string | null;
  rulesTree: XmlElement | null;
};
type Named = { name: string; reason: string };
type Keyed = { key: string; reason: string };
type ManifestCheckModule = {
  judgeManifestSurface: (text: string) => string[];
  judgeBackup: (facts: BackupFacts) => string[];
  checkManifest: (dump: (...args: string[]) => string, apk?: string) => string[];
  ALLOWED_PERMISSIONS: Named[];
  ALLOWED_DECLARED_PERMISSIONS: Named[];
  ALLOWED_QUERIES: Keyed[];
};

async function loadCheck(): Promise<ManifestCheckModule> {
  expect(existsSync(SCRIPT), "scripts/tv-apk-manifest.mjs exists").toBe(true);
  return (await import(pathToFileURL(SCRIPT).href)) as ManifestCheckModule;
}

function pluginRulesXml(): string {
  const path = join(repo, "apps", "tv", "plugins", "with-trimmed-manifest.js");
  expect(existsSync(path), "apps/tv/plugins/with-trimmed-manifest.js exists").toBe(true);
  const xml = (createRequire(import.meta.url)(path) as { DATA_EXTRACTION_RULES_XML: string }).DATA_EXTRACTION_RULES_XML;
  expect(typeof xml).toBe("string");
  return xml;
}

function expectErrors(errors: string[], cause?: RegExp | string) {
  expect(errors.length, "the check refuses this").toBeGreaterThan(0);
  for (const error of errors) expect(error).toMatch(/^ERROR tv apk: /);
  if (typeof cause === "string") expect(errors.join("\n")).toContain(cause);
  else if (cause) expect(errors.join("\n")).toMatch(cause);
}

// --- The manifest surface ---------------------------------------------------------------------------------------

// Removes one element (its `E:` line and every deeper line after it), asserting it was there.
function removeElement(text: string, header: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  expect(start, `the dump holds ${header}`).toBeGreaterThan(-1);
  const indent = lines[start].length - lines[start].trimStart().length;
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== "" && lines[end].length - lines[end].trimStart().length > indent) end += 1;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

// Inserts lines after the line whose trimmed text is `after`, asserting it was there.
function insertAfter(text: string, after: string, block: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim() === after);
  expect(at, `the dump holds ${after}`).toBeGreaterThan(-1);
  return [...lines.slice(0, at + 1), ...block.split("\n"), ...lines.slice(at + 1)].join("\n");
}

const nameAttr = (indent: number, attribute: string, id: string, value: string) =>
  `${" ".repeat(indent)}A: http://schemas.android.com/apk/res/android:${attribute}(${id})="${value}" (Raw: "${value}")`;

// The seven entries this task removes, as the fixture holds them, and a token each error line must name.
const REMOVED = [
  { header: "E: uses-permission (line=12)", token: "android.permission.READ_EXTERNAL_STORAGE" },
  { header: "E: uses-permission (line=15)", token: "android.permission.SYSTEM_ALERT_WINDOW" },
  { header: "E: uses-permission (line=16)", token: "android.permission.VIBRATE" },
  { header: "E: uses-permission (line=17)", token: "android.permission.WRITE_EXTERNAL_STORAGE" },
  { header: "E: intent (line=32)", token: "https" },
  { header: "E: intent (line=40)", token: "OPEN_DOCUMENT_TREE" },
  { header: "E: intent (line=43)", token: "*/*" },
];

// The dump with every removed entry dropped and the <queries> element left empty.
function trimmedExcept(keep?: string): string {
  return REMOVED.filter((entry) => entry.header !== keep).reduce((text, entry) => removeElement(text, entry.header), BEFORE);
}
const TRIMMED_HEADER_QUERIES = "E: queries (line=31)";
const APPLICATION = "E: application (line=58)";

function withManifestChild(text: string, block: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim() === APPLICATION);
  expect(at, "the dump holds the application element").toBeGreaterThan(-1);
  return [...lines.slice(0, at), ...block.split("\n"), ...lines.slice(at)].join("\n");
}

describe("judgeManifestSurface", () => {
  it("T3-22 item 2: passes the manifest with the removed entries dropped, INTERNET and androidx's receiver permission kept", async () => {
    const { judgeManifestSurface } = await loadCheck();
    const text = trimmedExcept();
    expect(text).toContain('"android.permission.INTERNET"');
    expect(text).toContain('"cloud.jellyscale.octave.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"');
    expect(judgeManifestSurface(text)).toEqual([]);
  });

  it("T3-22 item 2: passes a manifest with no <queries> element at all", async () => {
    const { judgeManifestSurface } = await loadCheck();
    expect(judgeManifestSurface(removeElement(trimmedExcept(), TRIMMED_HEADER_QUERIES))).toEqual([]);
  });

  it.each(REMOVED)("T3-22 item 2: fails, naming it, when the removed $token is back ($header)", async ({ header, token }) => {
    const { judgeManifestSurface } = await loadCheck();
    const errors = judgeManifestSurface(trimmedExcept(header));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR tv apk: /);
    expect(errors[0]).toContain(token);
  });

  it("T3-22 item 2: fails a permission no list names", async () => {
    const { judgeManifestSurface } = await loadCheck();
    const block = ["      E: uses-permission (line=200)", nameAttr(8, "name", "0x01010003", "android.permission.CAMERA")].join("\n");
    const errors = judgeManifestSurface(withManifestChild(trimmedExcept(), block));
    expect(errors).toHaveLength(1);
    expectErrors(errors, "android.permission.CAMERA");
  });

  it("T3-22 item 2: fails a uses-permission-sdk-23 no list names", async () => {
    const { judgeManifestSurface } = await loadCheck();
    const block = ["      E: uses-permission-sdk-23 (line=200)", nameAttr(8, "name", "0x01010003", "android.permission.RECORD_AUDIO")].join("\n");
    const errors = judgeManifestSurface(withManifestChild(trimmedExcept(), block));
    expect(errors).toHaveLength(1);
    expectErrors(errors, "android.permission.RECORD_AUDIO");
  });

  it.each(["permission", "permission-group", "permission-tree"])("T3-22 item 2: fails a declared %s no list names", async (element) => {
    const { judgeManifestSurface } = await loadCheck();
    const block = [`      E: ${element} (line=200)`, nameAttr(8, "name", "0x01010003", "cloud.jellyscale.octave.EXTRA_DECLARED")].join("\n");
    const errors = judgeManifestSurface(withManifestChild(trimmedExcept(), block));
    expect(errors).toHaveLength(1);
    expectErrors(errors, "cloud.jellyscale.octave.EXTRA_DECLARED");
  });

  it("T3-22 item 2: fails a <package> under <queries>", async () => {
    const { judgeManifestSurface } = await loadCheck();
    const block = ["          E: package (line=201)", nameAttr(12, "name", "0x01010003", "com.example.player")].join("\n");
    const errors = judgeManifestSurface(insertAfter(trimmedExcept(), TRIMMED_HEADER_QUERIES, block));
    expect(errors).toHaveLength(1);
    expectErrors(errors, "com.example.player");
  });

  it("T3-22 item 2: fails a <provider> under <queries>", async () => {
    const { judgeManifestSurface } = await loadCheck();
    const block = ["          E: provider (line=201)", nameAttr(12, "authorities", "0x01010018", "com.example.provider")].join("\n");
    const errors = judgeManifestSurface(insertAfter(trimmedExcept(), TRIMMED_HEADER_QUERIES, block));
    expect(errors).toHaveLength(1);
    expectErrors(errors, "com.example.provider");
  });

  it("T3-22 item 2: fails an unlisted <intent> under <queries>", async () => {
    const { judgeManifestSurface } = await loadCheck();
    const block = [
      "          E: intent (line=201)",
      "              E: action (line=202)",
      nameAttr(16, "name", "0x01010003", "android.intent.action.SEND"),
    ].join("\n");
    const errors = judgeManifestSurface(insertAfter(trimmedExcept(), TRIMMED_HEADER_QUERIES, block));
    expect(errors).toHaveLength(1);
    expectErrors(errors, "android.intent.action.SEND");
  });

  it.each([
    ["empty text", ""],
    ["text that is not a tree", "ERROR: dump failed: not an APK\n"],
  ])("T3-22 item 2: fails %s", async (_label, text) => {
    const { judgeManifestSurface } = await loadCheck();
    expectErrors(judgeManifestSurface(text));
  });

  it("T3-22 item 2: fails a tree whose root is not <manifest>", async () => {
    const { judgeManifestSurface } = await loadCheck();
    const text = trimmedExcept();
    expect(text).toContain("E: manifest (line=2)");
    expectErrors(judgeManifestSurface(text.replace("E: manifest (line=2)", "E: application (line=2)")));
  });

  it("T3-22 item 2: fails the recorded dump of today's APK with one line per unlisted entry", async () => {
    const { judgeManifestSurface } = await loadCheck();
    const errors = judgeManifestSurface(BEFORE);
    expect(errors).toHaveLength(REMOVED.length);
    for (const error of errors) expect(error).toMatch(/^ERROR tv apk: /);
    for (const { token } of REMOVED) {
      expect(errors.filter((error) => error.includes(token)), `one line names ${token}`).toHaveLength(1);
    }
  });
});

describe("the named lists", () => {
  it("T3-22 item 2: give every entry a reason and hold none of the removed entries", async () => {
    const { ALLOWED_PERMISSIONS, ALLOWED_DECLARED_PERMISSIONS, ALLOWED_QUERIES } = await loadCheck();
    for (const list of [ALLOWED_PERMISSIONS, ALLOWED_DECLARED_PERMISSIONS]) {
      expect(Array.isArray(list)).toBe(true);
      for (const entry of list) {
        expect(typeof entry.name).toBe("string");
        expect(entry.reason?.trim(), `${entry.name} has a reason`).toBeTruthy();
      }
    }
    expect(Array.isArray(ALLOWED_QUERIES)).toBe(true);
    for (const entry of ALLOWED_QUERIES) {
      expect(typeof entry.key).toBe("string");
      expect(entry.reason?.trim(), `${entry.key} has a reason`).toBeTruthy();
    }
    const names = [...ALLOWED_PERMISSIONS, ...ALLOWED_DECLARED_PERMISSIONS].map((entry) => entry.name);
    for (const { token } of REMOVED.slice(0, 4)) expect(names).not.toContain(token);
    for (const { token } of REMOVED.slice(4)) {
      for (const entry of ALLOWED_QUERIES) expect(entry.key).not.toContain(token);
    }
  });
});

describe("pnpm tv:apk:check runs the manifest check", () => {
  it("T3-22 item 2: package.json's tv:apk:check runs the manifest script after the badging script", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const command = pkg.scripts["tv:apk:check"] ?? "";
    const badging = command.indexOf("node scripts/tv-apk-check.mjs");
    const manifest = command.indexOf("node scripts/tv-apk-manifest.mjs");
    expect(badging, "tv:apk:check runs node scripts/tv-apk-check.mjs").toBeGreaterThan(-1);
    expect(manifest, "tv:apk:check runs node scripts/tv-apk-manifest.mjs").toBeGreaterThan(badging);
  });

  // A temporary Android SDK whose only tool is an aapt2 that prints the recorded dump for `dump xmltree` and
  // nothing for any other call.
  function fakeSdk(): string {
    const sdk = mkdtempSync(join(tmpdir(), "octave-t3-22-sdk-"));
    const tools = join(sdk, "build-tools", "1.0.0");
    mkdirSync(tools, { recursive: true });
    const aapt2 = join(tools, "aapt2");
    writeFileSync(aapt2, `#!/bin/sh\nif [ "$1" = "dump" ] && [ "$2" = "xmltree" ]; then cat '${FIXTURE}'; fi\nexit 0\n`);
    chmodSync(aapt2, 0o755);
    writeFileSync(join(sdk, "app-release.apk"), "not a real APK; the fake aapt2 ignores it\n");
    return sdk;
  }

  function runCheck(sdk: string, apk: string) {
    const env: NodeJS.ProcessEnv = { ...process.env, ANDROID_HOME: sdk };
    delete env.ANDROID_SDK_ROOT;
    return spawnSync(process.execPath, [SCRIPT, apk], { cwd: repo, encoding: "utf8", env, timeout: 60_000 });
  }

  it("T3-22 item 2: the command exits 1 and names SYSTEM_ALERT_WINDOW when aapt2 prints today's manifest", () => {
    const sdk = fakeSdk();
    try {
      const child = runCheck(sdk, join(sdk, "app-release.apk"));
      expect(child.status, child.stderr).toBe(1);
      expect(child.stderr).toMatch(/^ERROR tv apk: .*SYSTEM_ALERT_WINDOW/m);
    } finally {
      rmSync(sdk, { recursive: true, force: true });
    }
  });

  it("T3-22 item 2: the command exits 1 with an error line when no APK is at the path", () => {
    const sdk = fakeSdk();
    try {
      const child = runCheck(sdk, join(sdk, "missing", "app-release.apk"));
      expect(child.status, child.stderr).toBe(1);
      expect(child.stderr).toMatch(/^ERROR tv apk: /m);
    } finally {
      rmSync(sdk, { recursive: true, force: true });
    }
  });
});

// --- Backup -----------------------------------------------------------------------------------------------------

const DOMAINS = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"];

const element = (name: string, attributes: Record<string, string> = {}, children: XmlElement[] = []): XmlElement => ({
  name,
  attributes,
  children,
});

// The `path` the plugin's rules file gives the root domain's exclude, so this file does not pin its spelling.
function pluginExcludePath(): string | undefined {
  const xml = pluginRulesXml().replace(/<!--[\s\S]*?-->/g, "");
  for (const match of xml.matchAll(/<exclude\b([^>]*)>/g)) {
    if (/\bdomain="root"/.test(match[1])) return /\bpath="([^"]*)"/.exec(match[1])?.[1];
  }
  return undefined;
}

function exclude(domain: string): XmlElement {
  const path = pluginExcludePath();
  return element("exclude", path === undefined ? { domain } : { domain, path });
}

const sectionTree = (name: string, domains = DOMAINS) => element(name, {}, domains.map(exclude));
const goodRulesTree = () => element("data-extraction-rules", {}, [sectionTree("cloud-backup"), sectionTree("device-transfer")]);

const goodFacts = (overrides: Partial<BackupFacts> = {}): BackupFacts => ({
  allowBackup: false,
  fullBackupContent: null,
  rulesAttribute: "@0x7f130001",
  rulesFile: "res/y4.xml",
  rulesTree: goodRulesTree(),
  ...overrides,
});

describe("judgeBackup", () => {
  it("T3-22 item 3: passes allowBackup=false with rules that exclude every domain from both modes", async () => {
    const { judgeBackup } = await loadCheck();
    expect(judgeBackup(goodFacts())).toEqual([]);
  });

  it("T3-22 item 3: passes fullBackupContent=false", async () => {
    const { judgeBackup } = await loadCheck();
    expect(judgeBackup(goodFacts({ fullBackupContent: false }))).toEqual([]);
  });

  it("T3-22 item 3: fails an absent allowBackup, which Android reads as true", async () => {
    const { judgeBackup } = await loadCheck();
    expectErrors(judgeBackup(goodFacts({ allowBackup: null })), "allowBackup");
  });

  it("T3-22 item 3: fails allowBackup=true", async () => {
    const { judgeBackup } = await loadCheck();
    expectErrors(judgeBackup(goodFacts({ allowBackup: true })), "allowBackup");
  });

  it("T3-22 item 3: fails a missing dataExtractionRules attribute", async () => {
    const { judgeBackup } = await loadCheck();
    expectErrors(judgeBackup(goodFacts({ rulesAttribute: null, rulesFile: null, rulesTree: null })), "dataExtractionRules");
  });

  it("T3-22 item 3: fails a dataExtractionRules reference that resolves to no file", async () => {
    const { judgeBackup } = await loadCheck();
    expectErrors(judgeBackup(goodFacts({ rulesFile: null, rulesTree: null })));
  });

  it("T3-22 item 3: fails a rules file whose root is not data-extraction-rules", async () => {
    const { judgeBackup } = await loadCheck();
    const tree = element("full-backup-content", {}, goodRulesTree().children);
    expectErrors(judgeBackup(goodFacts({ rulesTree: tree })));
  });

  it.each(["cloud-backup", "device-transfer"])("T3-22 item 3: fails an <include> in %s", async (name) => {
    const { judgeBackup } = await loadCheck();
    const tree = goodRulesTree();
    const target = tree.children.find((child) => child.name === name) as XmlElement;
    target.children.push(element("include", { domain: "sharedpref", path: "prefs.xml" }));
    expectErrors(judgeBackup(goodFacts({ rulesTree: tree })), "include");
  });

  it.each(["cloud-backup", "device-transfer"])("T3-22 item 3: fails rules without a %s section", async (name) => {
    const { judgeBackup } = await loadCheck();
    const tree = goodRulesTree();
    tree.children = tree.children.filter((child) => child.name !== name);
    expectErrors(judgeBackup(goodFacts({ rulesTree: tree })), name);
  });

  it("T3-22 item 3: fails rules with a second cloud-backup section", async () => {
    const { judgeBackup } = await loadCheck();
    const tree = goodRulesTree();
    tree.children.push(sectionTree("cloud-backup"));
    expectErrors(judgeBackup(goodFacts({ rulesTree: tree })));
  });

  it("T3-22 item 3: fails rules with a section other than cloud-backup and device-transfer", async () => {
    const { judgeBackup } = await loadCheck();
    const tree = goodRulesTree();
    tree.children.push(element("cross-platform-transfer", { platform: "ios" }, DOMAINS.map(exclude)));
    expectErrors(judgeBackup(goodFacts({ rulesTree: tree })));
  });

  const missing = ["cloud-backup", "device-transfer"].flatMap((name) => DOMAINS.map((domain) => [name, domain]));
  it.each(missing)("T3-22 item 3: fails a %s section without the %s domain's exclude", async (name, domain) => {
    const { judgeBackup } = await loadCheck();
    const tree = element("data-extraction-rules", {}, [
      sectionTree("cloud-backup", name === "cloud-backup" ? DOMAINS.filter((d) => d !== domain) : DOMAINS),
      sectionTree("device-transfer", name === "device-transfer" ? DOMAINS.filter((d) => d !== domain) : DOMAINS),
    ]);
    expectErrors(judgeBackup(goodFacts({ rulesTree: tree })), domain);
  });

  it("T3-22 item 3: fails an exclude that covers only part of a domain", async () => {
    const { judgeBackup } = await loadCheck();
    const tree = goodRulesTree();
    const cloud = tree.children.find((child) => child.name === "cloud-backup") as XmlElement;
    cloud.children = cloud.children.map((child) =>
      child.attributes.domain === "sharedpref" ? element("exclude", { domain: "sharedpref", path: "octave_secret.xml" }) : child,
    );
    expectErrors(judgeBackup(goodFacts({ rulesTree: tree })), "sharedpref");
  });

  it("T3-22 item 3: fails a fullBackupContent attribute that is not false", async () => {
    const { judgeBackup } = await loadCheck();
    expectErrors(judgeBackup(goodFacts({ fullBackupContent: "@0x7f130002" })), "fullBackupContent");
  });
});

describe("checkManifest", () => {
  it("T3-22 item 3: fails when the manifest's dataExtractionRules names a resource the table does not hold", async () => {
    const { checkManifest } = await loadCheck();
    const ALLOW = "A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=true";
    const manifest = trimmedExcept();
    expect(manifest).toContain(ALLOW);
    const text = manifest.replace(
      ALLOW,
      [
        "A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false",
        "        A: http://schemas.android.com/apk/res/android:dataExtractionRules(0x0101063e)=@0x7f130001",
      ].join("\n"),
    );
    const calls: string[][] = [];
    const dump = (...args: string[]) => {
      calls.push(args);
      if (args[0] === "xmltree" && args.includes("AndroidManifest.xml")) return text;
      return "";
    };
    const errors = checkManifest(dump, "app-release.apk");
    expect(calls.some((args) => args[0] === "xmltree" && args.includes("AndroidManifest.xml")), "checkManifest reads the manifest").toBe(true);
    expectErrors(errors, /dataExtractionRules|0x7f130001/);
  });
});

// --- docs/security.md -------------------------------------------------------------------------------------------

function releaseManifestSection(): string {
  const lines = read("docs/security.md").split("\n");
  const start = lines.findIndex((line) => /^## 6\. The release manifest\s*$/.test(line));
  expect(start, "docs/security.md has a section `## 6. The release manifest`").toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

describe("docs/security.md states the permissions and the backup rule", () => {
  it("T3-22 item 5: section 6 names every allowed permission, the backup settings, the command and this test", async () => {
    const section = releaseManifestSection();
    const { ALLOWED_PERMISSIONS, ALLOWED_DECLARED_PERMISSIONS } = await loadCheck();
    for (const { name } of [...ALLOWED_PERMISSIONS, ...ALLOWED_DECLARED_PERMISSIONS]) {
      expect(section, `section 6 names ${name}`).toContain(name);
    }
    for (const text of ["allowBackup", "dataExtractionRules", "pnpm tv:apk:check", "scripts/tv-apk-manifest.test.ts"]) {
      expect(section, `section 6 names ${text}`).toContain(text);
    }
  });
});
