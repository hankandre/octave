// @vitest-environment node
// T3-15, written during implementation (docs/specs/T3-15.md, Test plan): the aapt2 readers scripts/tv-apk-check.mjs uses
// (its own and those it shares from scripts/tv-aapt2-xml.mjs)
// and parseInstrumentation of scripts/tv-cleartext.mjs on output recorded from a real release APK and a real probe run
// (scripts/fixtures/tv/, aapt2 2.20 from build-tools 37.0.0, an API 36 Android TV emulator); that e2eSourceHash sees
// modules/ but not their build output or JVM tests; and that with-device-probe appends its Gradle block once.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { judgeNetworkSecurity, parseXmlTree, readManifestNetworkSecurity, resolveResourceFile } from "./tv-apk-check.mjs";
import { e2eSourceHash } from "./tv-build.mjs";
import { CANARY_HEADER, LOOPBACK_PATH, PRIVATE_LAN_PATH, expectedPublicCount, judgeCleartext, parseInstrumentation } from "./tv-cleartext.mjs";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/tv/${name}`, import.meta.url), "utf8");

describe("the aapt2 parsers on a real release APK", () => {
  it("reads the application's networkSecurityConfig reference and no usesCleartextTraffic", () => {
    expect(readManifestNetworkSecurity(fixture("xmltree-manifest-release.txt"))).toEqual({
      configAttribute: "@0x7f130006",
      usesCleartextTraffic: null,
      problems: [],
    });
  });

  it("reads usesCleartextTraffic when the manifest sets it", () => {
    const text = fixture("xmltree-manifest-release.txt").replace(
      /^(\s+)(A: http:\/\/schemas\.android\.com\/apk\/res\/android:networkSecurityConfig.*)$/m,
      "$1A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=true\n$1$2",
    );
    expect(readManifestNetworkSecurity(text).usesCleartextTraffic).toBe(true);
  });

  it("resolves the reference to its one file through the resource table", () => {
    const table = fixture("resources-network-security-config.txt");
    expect(resolveResourceFile(table, "@0x7f130006")).toBe("res/c-.xml");
    expect(resolveResourceFile(table, "@0x7f130007")).toBe("res/Sa.xml");
    expect(resolveResourceFile(table, "@0x7f139999")).toBeNull();
    expect(resolveResourceFile(table, "res/c-.xml")).toBeNull();
    expect(resolveResourceFile(table, null)).toBeNull();
  });

  it("refuses a resource with more than one file entry", () => {
    const table = fixture("resources-network-security-config.txt").replace(
      "      () (file) res/c-.xml type=XML\n",
      "      () (file) res/c-.xml type=XML\n      (v24) (file) res/zz.xml type=XML\n",
    );
    expect(resolveResourceFile(table, "@0x7f130006")).toBeNull();
  });

  it("reads the packaged configuration as the one wanted tree, which the judge passes", () => {
    const tree = parseXmlTree(fixture("xmltree-network-security-config.txt"), "any-namespace");
    expect(tree).toEqual({
      name: "network-security-config",
      attributes: {},
      children: [{ name: "base-config", attributes: { cleartextTrafficPermitted: "true" }, children: [] }],
    });
    const facts = { ...readManifestNetworkSecurity(fixture("xmltree-manifest-release.txt")), configFile: "res/c-.xml", tree };
    expect(judgeNetworkSecurity(facts)).toEqual([]);
  });

  it("reads the manifest tree with string values unquoted and namespaces dropped", () => {
    const manifest = parseXmlTree(fixture("xmltree-manifest-release.txt"), "manifest");
    expect(manifest?.name).toBe("manifest");
    const application = manifest?.children.find((child) => child.name === "application");
    expect(application?.attributes.name).toBe("dev.octave.tv.MainApplication");
    expect(application?.attributes.allowBackup).toBe("false");
  });

  it("fails closed on text it cannot read", () => {
    expect(parseXmlTree("", "manifest")).toBeNull();
    expect(parseXmlTree("ERROR: not an xml file\n", "manifest")).toBeNull();
    expect(parseXmlTree("A: cleartextTrafficPermitted=true\n", "any-namespace")).toBeNull();
    expect(parseXmlTree("E: a (line=1)\nE: b (line=2)\n", "manifest")).toBeNull();
  });
});

describe("parseInstrumentation on a real probe run", () => {
  const port = 41999;
  const served = [
    { path: PRIVATE_LAN_PATH, host: `10.0.2.2:${port}`, header: true },
    { path: LOOPBACK_PATH, host: `127.0.0.1:${port}`, header: true },
  ];

  it("reads every key, and the judge passes the run", () => {
    const report = parseInstrumentation(fixture("instrument-cleartext.txt"));
    expect(report).toEqual({
      done: "yes",
      "https-open": "ok",
      loopback: "200",
      policy: "permitted",
      "private-lan": "200",
      "public-other": "0",
      "public-refused": "60",
      "public-total": "60",
      "target-sdk": "36",
    });
    expect(judgeCleartext(report, served, { publicTotal: expectedPublicCount(), port })).toEqual([]);
  });

  it("drops done when the run failed or has no RESULT_OK code", () => {
    const text = fixture("instrument-cleartext.txt");
    expect(parseInstrumentation(text.replace("INSTRUMENTATION_CODE: -1", "INSTRUMENTATION_CODE: 0")).done).toBeUndefined();
    expect(parseInstrumentation(text.replace(/INSTRUMENTATION_CODE: -1\s*$/, "")).done).toBeUndefined();
    expect(parseInstrumentation(`${text}INSTRUMENTATION_FAILED: dev.octave.session.test/x\n`).done).toBeUndefined();
    expect(parseInstrumentation("")).toEqual({});
  });

  it("the canary is a header the module's parser would accept, with no address in it", () => {
    expect(CANARY_HEADER).toMatch(/^MediaBrowser Client="[^"]*", Device="[^"]*", DeviceId="[^"]*", Version="[^"]*", Token="[A-Za-z0-9]+"$/);
    expect(CANARY_HEADER).not.toMatch(/\d+\.\d+\.\d+\.\d+|octave-probe|private-lan|loopback/);
  });
});

describe("e2eSourceHash and the native modules", () => {
  let root: string;
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "octave-e2e-modules-"));
    write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    write("apps/tv/index.js", "registerRootComponent(App);\n");
    write("modules/session/android/src/main/AndroidManifest.xml", "<manifest />\n");
    write("modules/session/android/src/androidTest/java/Probe.kt", "class Probe\n");
    write("modules/session/android/src/test/java/SomeTest.kt", "class SomeTest\n");
    write("modules/session/android/build/outputs/x.txt", "out\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    ["modules/session/android/src/main/AndroidManifest.xml", "<manifest changed />\n"],
    ["modules/session/android/src/androidTest/java/Probe.kt", "class Probe2\n"],
  ])("changes when %s changes", (path, text) => {
    const before = e2eSourceHash(root);
    write(path, text);
    expect(e2eSourceHash(root)).not.toBe(before);
  });

  it.each([
    ["modules/session/android/src/test/java/SomeTest.kt", "class SomeTest2\n"],
    ["modules/session/android/build/outputs/x.txt", "changed\n"],
  ])("does not change when %s changes", (path, text) => {
    const before = e2eSourceHash(root);
    write(path, text);
    expect(e2eSourceHash(root)).toBe(before);
  });
});

describe("with-device-probe", () => {
  const require = createRequire(import.meta.url);
  const probe = require("../apps/tv/plugins/with-device-probe.js") as typeof import("../apps/tv/plugins/with-device-probe.js");
  const jvm = require("../apps/tv/plugins/with-app-jvm-tests.js") as typeof import("../apps/tv/plugins/with-app-jvm-tests.js");
  const ROOT_TEMPLATE = `apply plugin: "expo-root-project"\napply plugin: "com.facebook.react.rootproject"\n`;

  it("appends the probe task once after the template", () => {
    const once = probe.addProbeTask(ROOT_TEMPLATE);
    expect(once.startsWith(ROOT_TEMPLATE)).toBe(true);
    expect(once).toContain('tasks.register("octaveDeviceProbeApk")');
    expect(once).toContain('findByName("assembleDebugAndroidTest")');
    expect(probe.addProbeTask(once)).toBe(once);
  });

  it("leaves with-app-jvm-tests' block alone, in either order", () => {
    const jvmFirst = probe.addProbeTask(jvm.addRootTask(ROOT_TEMPLATE));
    expect(jvmFirst.startsWith(jvm.addRootTask(ROOT_TEMPLATE))).toBe(true);
    const probeFirst = jvm.addRootTask(probe.addProbeTask(ROOT_TEMPLATE));
    expect(probeFirst.startsWith(probe.addProbeTask(ROOT_TEMPLATE))).toBe(true);
    for (const out of [jvmFirst, probeFirst]) {
      expect(out.match(/octaveNativeTest"/g)).toHaveLength(1);
      expect(out.match(/octaveDeviceProbeApk"/g)).toHaveLength(1);
    }
  });
});
