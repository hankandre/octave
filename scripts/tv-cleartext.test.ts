// @vitest-environment node
// T3-15: the Android app permits cleartext app-wide through one network security configuration declared by
// modules/session, and the host classifier is the only gate (decision 0001, docs/security.md section 3).
//
// The frozen layer is the two pure judges and the source files they guard (docs/specs/T3-15.md, Test plan):
// - scripts/tv-apk-check.mjs: judgeNetworkSecurity(facts) over the facts read from an APK with aapt2. It returns
//   `ERROR tv apk: ...` lines, empty only for the one wanted configuration.
// - scripts/tv-cleartext.mjs: judgeCleartext(report, served, expected) over the device probe's report and the host
//   server's record, and expectedPublicCount() from the shared host-class vectors.
//
// Shapes this file freezes (spec check notes 2, 3 and 5, settled at the freeze):
// - expected = { publicTotal: number; port: number }.
// - served = one record per request the host server saw: { path: string; host: string; header: boolean }, where
//   header says whether Authorization equalled the canary value.
// - report = Record<string, string>, values as `am instrument` gives them ("200", "36", "60"); the judge parses
//   numbers itself.
// - The two source files are compared by parsed structure (elements and attributes); the XML prolog, comments and
//   white space are ignored, never compared by bytes.
// - The host server must have seen no request other than the two expected ones.
//
// Modules that later milestones create are loaded at run time from a path built here, so `pnpm typecheck` does not
// depend on them existing.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

const MODULE_MANIFEST = "modules/session/android/src/main/AndroidManifest.xml";
const CONFIG_XML = "modules/session/android/src/main/res/xml/octave_network_security_config.xml";

type XmlElement = { name: string; attributes: Record<string, string>; children: XmlElement[] };
type NetworkSecurityFacts = {
  configAttribute: string | null;
  configFile: string | null;
  usesCleartextTraffic: boolean | null;
  tree: XmlElement | null;
};
type ApkCheckModule = { judgeNetworkSecurity: (facts: NetworkSecurityFacts) => string[] };

type Report = Record<string, string>;
type Served = { path: string; host: string; header: boolean };
type Expected = { publicTotal: number; port: number };
type CleartextModule = {
  judgeCleartext: (report: Report, served: Served[], expected: Expected) => string[];
  expectedPublicCount: () => number;
};

async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(join(repo, path)).href)) as T;
}

async function loadJudgeNetworkSecurity() {
  const judge = (await load<ApkCheckModule>("scripts/tv-apk-check.mjs")).judgeNetworkSecurity;
  expect(typeof judge, "scripts/tv-apk-check.mjs exports judgeNetworkSecurity").toBe("function");
  return judge;
}

async function loadCleartext() {
  const module = await load<CleartextModule>("scripts/tv-cleartext.mjs");
  expect(typeof module.judgeCleartext, "scripts/tv-cleartext.mjs exports judgeCleartext").toBe("function");
  expect(typeof module.expectedPublicCount, "scripts/tv-cleartext.mjs exports expectedPublicCount").toBe("function");
  return module;
}

// --- Network security facts -------------------------------------------------------------------------------------

const element = (name: string, attributes: Record<string, string> = {}, children: XmlElement[] = []): XmlElement => ({
  name,
  attributes,
  children,
});

const wantedTree = () =>
  element("network-security-config", {}, [element("base-config", { cleartextTrafficPermitted: "true" })]);

const wantedFacts = (overrides: Partial<NetworkSecurityFacts> = {}): NetworkSecurityFacts => ({
  configAttribute: "@0x7f150002",
  configFile: "res/a1.xml",
  usesCleartextTraffic: null,
  tree: wantedTree(),
  ...overrides,
});

function expectApkErrors(errors: string[], cause: RegExp) {
  expect(errors.length, "the judge refuses these facts").toBeGreaterThan(0);
  for (const error of errors) expect(error).toMatch(/^ERROR tv apk: /);
  expect(errors.join("\n")).toMatch(cause);
}

// --- A small XML reader for the two source files: elements and attributes only -----------------------------------

function parseXml(text: string): XmlElement {
  const body = text
    .replace(/^﻿/, "")
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let last = 0;
  for (let match = tag.exec(body); match !== null; match = tag.exec(body)) {
    const between = body.slice(last, match.index);
    expect(between.trim(), `no text or unparsed markup between elements: ${between.trim()}`).toBe("");
    last = tag.lastIndex;
    const [, closing, name, attributeText, selfClosing] = match;
    if (closing) {
      const open = stack.pop();
      expect(open?.name, `</${name}> closes the open element`).toBe(name);
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const [, key, double, single] of attributeText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      expect(attributes[key], `attribute ${key} appears once`).toBeUndefined();
      attributes[key] = double ?? single;
    }
    const node = element(name, attributes);
    if (stack.length === 0) {
      expect(root, "one root element").toBeNull();
      root = node;
    } else stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  expect(body.slice(last).trim(), "nothing after the root element").toBe("");
  expect(stack, "every element is closed").toEqual([]);
  expect(root, "a root element").not.toBeNull();
  return root as XmlElement;
}

const withoutNamespaces = (attributes: Record<string, string>) =>
  Object.fromEntries(Object.entries(attributes).filter(([key]) => key !== "xmlns" && !key.startsWith("xmlns:")));

function sourceOf(path: string): string {
  expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  return read(path);
}

// --- Device probe report ----------------------------------------------------------------------------------------

const PORT = 41234;
const PRIVATE_LAN_PATH = "/octave-probe/private-lan";
const LOOPBACK_PATH = "/octave-probe/loopback";

function publicVectorCount(): number {
  const hosts = JSON.parse(read("packages/core/tests/fixtures/host-classes.json")) as { vectors: { class: string }[] };
  return hosts.vectors.filter((vector) => vector.class === "public").length;
}

const fullReport = (publicTotal: number, overrides: Report = {}): Report => ({
  policy: "permitted",
  "target-sdk": "36",
  "private-lan": "200",
  loopback: "200",
  "public-total": String(publicTotal),
  "public-refused": String(publicTotal),
  "public-other": "0",
  "https-open": "ok",
  done: "yes",
  ...overrides,
});

const fullServed = (): Served[] => [
  { path: PRIVATE_LAN_PATH, host: `10.0.2.2:${PORT}`, header: true },
  { path: LOOPBACK_PATH, host: `127.0.0.1:${PORT}`, header: true },
];

function expectCleartextErrors(errors: string[], cause: RegExp) {
  expect(errors.length, "the judge refuses this run").toBeGreaterThan(0);
  for (const error of errors) expect(error).toMatch(/^ERROR /);
  expect(errors.join("\n")).toMatch(cause);
}

// --- Item 1 -----------------------------------------------------------------------------------------------------

describe("judgeNetworkSecurity: the release APK permits cleartext app-wide", () => {
  it("T3-15 item 1: passes the facts of the wanted APK", async () => {
    const judge = await loadJudgeNetworkSecurity();
    expect(judge(wantedFacts())).toEqual([]);
  });

  it("T3-15 item 1: neither requires nor refuses usesCleartextTraffic, which Android ignores once a configuration is present", async () => {
    const judge = await loadJudgeNetworkSecurity();
    expect(judge(wantedFacts({ usesCleartextTraffic: true }))).toEqual([]);
    expect(judge(wantedFacts({ usesCleartextTraffic: false }))).toEqual([]);
  });

  it("T3-15 item 1: fails an APK whose manifest has no networkSecurityConfig attribute", async () => {
    const judge = await loadJudgeNetworkSecurity();
    expectApkErrors(judge(wantedFacts({ configAttribute: null, configFile: null, tree: null })), /networkSecurityConfig/);
  });

  it("T3-15 item 1: fails an APK that has only usesCleartextTraffic=true", async () => {
    const judge = await loadJudgeNetworkSecurity();
    expectApkErrors(
      judge({ configAttribute: null, configFile: null, usesCleartextTraffic: true, tree: null }),
      /networkSecurityConfig/,
    );
  });

  it("T3-15 item 1: fails an attribute that resolves to no file", async () => {
    const judge = await loadJudgeNetworkSecurity();
    expectApkErrors(judge(wantedFacts({ configFile: null, tree: null })), /networkSecurityConfig|resolve|file/i);
  });

  it("T3-15 item 1: fails a configuration whose tree could not be read", async () => {
    const judge = await loadJudgeNetworkSecurity();
    expect(judge(wantedFacts({ tree: null })).length).toBeGreaterThan(0);
  });

  it("T3-15 item 1: fails cleartextTrafficPermitted=false", async () => {
    const judge = await loadJudgeNetworkSecurity();
    const tree = element("network-security-config", {}, [element("base-config", { cleartextTrafficPermitted: "false" })]);
    expectApkErrors(judge(wantedFacts({ tree })), /cleartextTrafficPermitted/);
  });

  it("T3-15 item 1: fails a base-config without cleartextTrafficPermitted", async () => {
    const judge = await loadJudgeNetworkSecurity();
    const tree = element("network-security-config", {}, [element("base-config")]);
    expectApkErrors(judge(wantedFacts({ tree })), /cleartextTrafficPermitted/);
  });

  it("T3-15 item 1: fails a configuration with no base-config", async () => {
    const judge = await loadJudgeNetworkSecurity();
    expectApkErrors(judge(wantedFacts({ tree: element("network-security-config") })), /base-config/);
  });

  it("T3-15 item 1: fails a file whose root is not network-security-config", async () => {
    const judge = await loadJudgeNetworkSecurity();
    const tree = element("other-config", {}, [element("base-config", { cleartextTrafficPermitted: "true" })]);
    expectApkErrors(judge(wantedFacts({ tree })), /network-security-config/);
  });
});

describe("the module declares the configuration, and both scripts read it from the APK", () => {
  it("T3-15 item 1: the configuration file is one base-config that permits cleartext", () => {
    const root = parseXml(sourceOf(CONFIG_XML));
    expect(root.name).toBe("network-security-config");
    expect(withoutNamespaces(root.attributes)).toEqual({});
    expect(root.children).toEqual([element("base-config", { cleartextTrafficPermitted: "true" })]);
  });

  it("T3-15 item 1: the module's manifest names the configuration on <application> and sets nothing else", () => {
    const root = parseXml(sourceOf(MODULE_MANIFEST));
    expect(root.name).toBe("manifest");
    expect(root.children.map((child) => child.name)).toEqual(["application"]);
    const [application] = root.children;
    expect(application.attributes).toEqual({ "android:networkSecurityConfig": "@xml/octave_network_security_config" });
    expect(application.children).toEqual([]);
  });

  it("T3-15 item 1: pnpm tv:apk:check judges the APK's network security", () => {
    const source = read("scripts/tv-apk-check.mjs");
    expect(source).toMatch(/export\s+function\s+judgeNetworkSecurity\s*\(/);
    const calls = [...source.matchAll(/(?<!function\s+)\bjudgeNetworkSecurity\s*\(/g)];
    expect(calls.length, "tv-apk-check.mjs calls judgeNetworkSecurity, not only defines it").toBeGreaterThan(0);
  });

  it("T3-15 item 1: pnpm tv:e2e judges the e2e APK's network security", () => {
    const source = read("scripts/tv-e2e.mjs");
    expect(source).toMatch(/\bjudgeNetworkSecurity\s*\(/);
  });

  it("T3-15 item 1: the tv job still builds the release APK and runs pnpm tv:apk:check on it", () => {
    const lines = read(".github/workflows/ci.yml").split("\n");
    const start = lines.findIndex((line) => line === "  tv:");
    expect(start, "ci.yml has a job named tv").toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^ {2}\S/.test(line));
    const job = end === -1 ? rest : rest.slice(0, end);
    const step = (command: string) => job.findIndex((line) => new RegExp(`^\\s+(?:- )?run: ${command}\\s*$`).test(line));
    expect(step("pnpm tv:build")).toBeGreaterThan(-1);
    expect(step("pnpm tv:apk:check")).toBeGreaterThan(step("pnpm tv:build"));
    expect(job.some((line) => /\bpnpm tv:e2e\s*$/.test(line))).toBe(true);
  });
});

// --- Item 2 -----------------------------------------------------------------------------------------------------

describe("judgeCleartext: the probe reaches private LAN and loopback and refuses every public vector", () => {
  it("T3-15 item 2: expectedPublicCount reads the public vectors of host-classes.json", async () => {
    const { expectedPublicCount } = await loadCleartext();
    const count = publicVectorCount();
    expect(count).toBeGreaterThan(0);
    expect(expectedPublicCount()).toBe(count);
  });

  it("T3-15 item 2: passes a full report and the two expected requests", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    expect(judgeCleartext(fullReport(publicTotal), fullServed(), { publicTotal, port: PORT })).toEqual([]);
  });

  it("T3-15 item 2: passes a test APK that targets API 28 exactly", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    expect(judgeCleartext(fullReport(publicTotal, { "target-sdk": "28" }), fullServed(), { publicTotal, port: PORT })).toEqual([]);
  });

  const reportCases: [string, Report, RegExp][] = [
    ["the policy does not permit cleartext", { policy: "refused" }, /policy/],
    ["the test APK targets API 27, where Android permits cleartext by default", { "target-sdk": "27" }, /target-sdk/],
    ["the test APK targets API 24", { "target-sdk": "24" }, /target-sdk/],
    ["the target is not a number", { "target-sdk": "unknown" }, /target-sdk/],
    ["Android blocked the private-LAN request", { "private-lan": "failed-UnknownServiceException" }, /private-lan/],
    ["the client refused the private-LAN request", { "private-lan": "refused-public-http" }, /private-lan/],
    ["the private-LAN request got another status", { "private-lan": "500" }, /private-lan/],
    ["Android blocked the loopback request", { loopback: "failed-UnknownServiceException" }, /loopback/],
    ["the loopback request got another status", { loopback: "404" }, /loopback/],
    ["the public-refused count is not a number", { "public-refused": "many" }, /public-refused/],
    ["a public vector opened or failed with another code", { "public-other": "1" }, /public/],
    ["the probe did not finish", { done: "no" }, /done|finish/i],
    ["the https session did not open", { "https-open": "failed" }, /https/],
  ];

  for (const [what, overrides, cause] of reportCases) {
    it(`T3-15 item 2: fails when ${what}`, async () => {
      const { judgeCleartext } = await loadCleartext();
      const publicTotal = publicVectorCount();
      expectCleartextErrors(judgeCleartext(fullReport(publicTotal, overrides), fullServed(), { publicTotal, port: PORT }), cause);
    });
  }

  it("T3-15 item 2: fails a public-refused count below the fixture's count", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const report = fullReport(publicTotal, { "public-refused": String(publicTotal - 1), "public-other": "1" });
    expectCleartextErrors(judgeCleartext(report, fullServed(), { publicTotal, port: PORT }), /public/);
    const quiet = fullReport(publicTotal, { "public-refused": String(publicTotal - 1) });
    expectCleartextErrors(judgeCleartext(quiet, fullServed(), { publicTotal, port: PORT }), /public/);
  });

  it("T3-15 item 2: fails a probe that tried fewer public vectors than the fixture holds", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const short = String(publicTotal - 1);
    const report = fullReport(publicTotal, { "public-total": short, "public-refused": short });
    expectCleartextErrors(judgeCleartext(report, fullServed(), { publicTotal, port: PORT }), /public/);
  });

  for (const key of ["policy", "target-sdk", "private-lan", "loopback", "public-total", "public-refused", "public-other", "https-open", "done"]) {
    it(`T3-15 item 2: fails a report without ${key} and names it`, async () => {
      const { judgeCleartext } = await loadCleartext();
      const publicTotal = publicVectorCount();
      const report = fullReport(publicTotal);
      delete report[key];
      const escaped = key.replace(/[-]/g, "\\-");
      expectCleartextErrors(judgeCleartext(report, fullServed(), { publicTotal, port: PORT }), new RegExp(escaped));
    });
  }

  it("T3-15 item 2: fails an empty report, as from a probe that never ran", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    expect(judgeCleartext({}, [], { publicTotal, port: PORT }).length).toBeGreaterThan(0);
  });

  it("T3-15 item 2: fails when the server never saw the private-LAN request", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const served = fullServed().filter((record) => record.path !== PRIVATE_LAN_PATH);
    expectCleartextErrors(judgeCleartext(fullReport(publicTotal), served, { publicTotal, port: PORT }), /private-lan/);
  });

  it("T3-15 item 2: fails when the server never saw the loopback request", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const served = fullServed().filter((record) => record.path !== LOOPBACK_PATH);
    expectCleartextErrors(judgeCleartext(fullReport(publicTotal), served, { publicTotal, port: PORT }), /loopback/);
  });

  it("T3-15 item 2: fails a private-LAN request the server saw without the header", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const served = fullServed().map((record) => (record.path === PRIVATE_LAN_PATH ? { ...record, header: false } : record));
    expectCleartextErrors(judgeCleartext(fullReport(publicTotal), served, { publicTotal, port: PORT }), /private-lan/);
  });

  it("T3-15 item 2: fails a loopback request the server saw without the header", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const served = fullServed().map((record) => (record.path === LOOPBACK_PATH ? { ...record, header: false } : record));
    expectCleartextErrors(judgeCleartext(fullReport(publicTotal), served, { publicTotal, port: PORT }), /loopback/);
  });

  it("T3-15 item 2: fails a private-LAN request the server saw twice", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const served = [...fullServed(), fullServed()[0]];
    expectCleartextErrors(judgeCleartext(fullReport(publicTotal), served, { publicTotal, port: PORT }), /private-lan/);
  });

  it("T3-15 item 2: fails a loopback request the server saw twice", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const served = [...fullServed(), fullServed()[1]];
    expectCleartextErrors(judgeCleartext(fullReport(publicTotal), served, { publicTotal, port: PORT }), /loopback/);
  });

  it("T3-15 item 2: fails a private-LAN request that did not arrive through 10.0.2.2", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const served = fullServed().map((record) => (record.path === PRIVATE_LAN_PATH ? { ...record, host: `127.0.0.1:${PORT}` } : record));
    expectCleartextErrors(judgeCleartext(fullReport(publicTotal), served, { publicTotal, port: PORT }), /private-lan|host/i);
  });

  it("T3-15 item 2: fails a loopback request that did not arrive through 127.0.0.1 on the port", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const served = fullServed().map((record) => (record.path === LOOPBACK_PATH ? { ...record, host: `127.0.0.1:${PORT + 1}` } : record));
    expectCleartextErrors(judgeCleartext(fullReport(publicTotal), served, { publicTotal, port: PORT }), /loopback|host/i);
  });

  it("T3-15 item 2: fails when the server saw any request other than the two expected ones", async () => {
    const { judgeCleartext } = await loadCleartext();
    const publicTotal = publicVectorCount();
    const served = [...fullServed(), { path: "/", host: `127.0.0.1:${PORT}`, header: false }];
    expect(judgeCleartext(fullReport(publicTotal), served, { publicTotal, port: PORT }).length).toBeGreaterThan(0);
  });

  it("T3-15 item 2: pnpm tv:e2e runs the device probe", () => {
    const source = read("scripts/tv-e2e.mjs");
    expect(source).toMatch(/\brunCleartextProbe\s*\(/);
    expect(source).toMatch(/from\s+["']\.\/tv-cleartext\.mjs["']/);
  });

  it("T3-15 item 2: the probe run judges the report with judgeCleartext", () => {
    const source = sourceOf("scripts/tv-cleartext.mjs");
    expect(source).toMatch(/export\s+(?:async\s+)?function\s+runCleartextProbe\s*\(/);
    const calls = [...source.matchAll(/(?<!function\s+)\bjudgeCleartext\s*\(/g)];
    expect(calls.length, "tv-cleartext.mjs calls judgeCleartext, not only defines it").toBeGreaterThan(0);
  });
});

// --- Item 3 -----------------------------------------------------------------------------------------------------

describe("judgeNetworkSecurity: the configuration changes nothing for HTTPS", () => {
  const withBaseChild = (child: XmlElement) =>
    element("network-security-config", {}, [element("base-config", { cleartextTrafficPermitted: "true" }, [child])]);
  const withSibling = (sibling: XmlElement) =>
    element("network-security-config", {}, [element("base-config", { cleartextTrafficPermitted: "true" }), sibling]);

  const cases: [string, XmlElement, RegExp][] = [
    ["trust-anchors under base-config", withBaseChild(element("trust-anchors", {}, [element("certificates", { src: "user" })])), /trust-anchors/],
    ["certificateTransparency under base-config", withBaseChild(element("certificateTransparency", { enabled: "false" })), /certificateTransparency/],
    ["domainEncryption under base-config", withBaseChild(element("domainEncryption", { enabled: "false" })), /domainEncryption/],
    ["pin-set under base-config", withBaseChild(element("pin-set")), /pin-set/],
    [
      "a domain-config beside base-config",
      withSibling(element("domain-config", { cleartextTrafficPermitted: "false" }, [element("domain", { includeSubdomains: "true" })])),
      /domain-config/,
    ],
    ["debug-overrides beside base-config", withSibling(element("debug-overrides", {}, [element("trust-anchors")])), /debug-overrides/],
    [
      "a second base-config",
      withSibling(element("base-config", { cleartextTrafficPermitted: "true" })),
      /base-config/,
    ],
    [
      "a second attribute on base-config",
      element("network-security-config", {}, [element("base-config", { cleartextTrafficPermitted: "true", hstsEnforced: "false" })]),
      /hstsEnforced/,
    ],
  ];

  for (const [what, tree, cause] of cases) {
    it(`T3-15 item 3: fails ${what} and names it`, async () => {
      const judge = await loadJudgeNetworkSecurity();
      expectApkErrors(judge(wantedFacts({ tree })), cause);
    });
  }

  it("T3-15 item 3: passes the one wanted configuration", async () => {
    const judge = await loadJudgeNetworkSecurity();
    expect(judge(wantedFacts())).toEqual([]);
  });

  it("T3-15 item 3: the source configuration has exactly one element under the root, with one attribute and no children", () => {
    const root = parseXml(sourceOf(CONFIG_XML));
    expect(root.children).toHaveLength(1);
    const [base] = root.children;
    expect(base.name).toBe("base-config");
    expect(Object.keys(base.attributes)).toEqual(["cleartextTrafficPermitted"]);
    expect(base.children).toEqual([]);
  });
});

// --- Item 4 -----------------------------------------------------------------------------------------------------

function cleartextBullet(): string {
  const lines = read("docs/security.md").split("\n");
  const start = lines.findIndex((line) => line.startsWith("- **Cleartext on Android.**"));
  expect(start, "docs/security.md has the Cleartext on Android bullet").toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("- ") || line.startsWith("#"));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

describe("docs/security.md names this task's tests", () => {
  it("T3-15 item 4: the Cleartext on Android bullet names the configuration and its tests and no longer defers to T3-15", () => {
    const bullet = cleartextBullet();
    for (const name of ["scripts/tv-cleartext.test.ts", "CleartextProbe", "pnpm tv:apk:check", "pnpm tv:e2e", "octave_network_security_config.xml"]) {
      expect(bullet, `the bullet names ${name}`).toContain(name);
    }
    expect(bullet).not.toContain("configuration is T3-15");
  });
});
