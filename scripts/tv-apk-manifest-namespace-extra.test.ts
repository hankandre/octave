// @vitest-environment node
// T3-23 milestone 3 (docs/specs/T3-23.md), not frozen: the cases the acceptance tests do not reach. D4 (an element is read
// by its local name) is a scope choice the review should look at; the probe lines are as `aapt2 dump xmltree` printed them
// for the probe APK recorded in the spec.
import { describe, expect, it } from "vitest";
import { judgeManifestSurface, parseXmlTree, readXmlTree } from "./tv-apk-manifest.mjs";

const ANDROID = "http://schemas.android.com/apk/res/android";
const manifest = (...body: string[]) => ["N: android=" + ANDROID + " (line=2)", "E: manifest (line=2)", ...body.map((line) => `  ${line}`)].join("\n");

describe("T3-23 extra: reading modes", () => {
  it("T3-23 extra: a missing or unknown mode throws", () => {
    const text = manifest();
    expect(() => (parseXmlTree as (text: string, mode?: string) => unknown)(text)).toThrow(/reading mode/);
    expect(() => parseXmlTree(text, "any" as never)).toThrow(/reading mode/);
  });

  it("T3-23 extra: D4, a namespaced element is read by its local name, so a namespaced uses-permission is judged", () => {
    const errors = judgeManifestSurface(
      manifest(
        `E: http://example.com/x:uses-permission (line=3)`,
        `  A: ${ANDROID}:name(0x01010003)="android.permission.CAMERA" (Raw: "android.permission.CAMERA")`,
      ),
    );
    expect(errors.some((line) => line.includes("android.permission.CAMERA"))).toBe(true);
  });

  it("T3-23 extra: the probe APK's lines, as printed, are a duplicate and read only the framework attribute", () => {
    const text = manifest(
      "E: uses-permission (line=12)",
      `  A: ${ANDROID}:name(0x01010003)="android.permission.INTERNET" (Raw: "android.permission.INTERNET")`,
      `  A: name="probe.none" (Raw: "probe.none")`,
      `  A: http://example.com/x:name="probe.other" (Raw: "probe.other")`,
    );
    const { tree, problems } = readXmlTree(text, "manifest");
    expect(tree?.children[0].attributes).toEqual({ name: "android.permission.INTERNET" });
    expect(problems).toEqual(["uses-permission (line=12) has two attributes named name", "uses-permission (line=12) has two attributes named name"]);
  });

  it("T3-23 extra: a skipped attribute never blocks a later one the mode takes, and a taken one is never replaced", () => {
    const text = [
      "E: data-extraction-rules (line=1)",
      "  E: exclude (line=2)",
      `    A: http://example.com/x:path="."`,
      `    A: path="a" (Raw: "a")`,
      `    A: path="b" (Raw: "b")`,
    ].join("\n");
    const { tree, problems } = readXmlTree(text, "no-namespace");
    expect(tree?.children[0].attributes).toEqual({ path: "a" });
    expect(problems).toHaveLength(2);
  });

  it("T3-23 extra: an attribute whose id is not a framework id is not read in manifest mode", () => {
    const { tree } = readXmlTree(manifest(`A: http://example.com/x:name(0x7f010001)="x"`), "manifest");
    expect(tree?.attributes).toEqual({});
  });
});

describe("T3-23 extra: a namespace URI cannot fake an attribute", () => {
  const FAKE_BACKUP = 'A: allowBackup(0x01010280)="false" x:foo="bar" (Raw: "bar")';
  const FAKE_DOMAIN = 'A: domain="sharedpref" x:y="z" (Raw: "z")';
  it("T3-23 extra: a line whose namespace holds `=` and a quote is unreadable, in manifest and no-namespace mode", () => {
    expect(parseXmlTree(manifest("E: application (line=5)", `  ${FAKE_BACKUP}`), "manifest")).toBeNull();
    expect(parseXmlTree(manifest("E: application (line=5)", `  ${FAKE_DOMAIN}`), "no-namespace")).toBeNull();
    expect(parseXmlTree(manifest("E: application (line=5)", `  ${FAKE_DOMAIN}`), "any-namespace")).toBeNull();
  });

  it("T3-23 extra: text after the value other than a Raw copy is unreadable, and a bare value with a space is too", () => {
    expect(parseXmlTree(manifest("E: application (line=5)", '  A: name="a" junk'), "no-namespace")).toBeNull();
    expect(parseXmlTree(manifest("E: application (line=5)", "  A: allowBackup=false x:foo=true"), "no-namespace")).toBeNull();
    expect(parseXmlTree(manifest("E: application (line=5)", '  A: name="a" (Raw: "a")'), "no-namespace")?.children[0].attributes).toEqual({ name: "a" });
  });

  it("T3-23 extra: a Raw copy that is not the value itself is unreadable, so it cannot hide a second attribute", () => {
    const hiddenInRaw = 'A: allowBackup(0x01010280)="false" (Raw: "x" y:foo="bar" (Raw: "bar")';
    const valueFakesRaw = 'A: path="." (Raw: "y" (Raw: "." (Raw: "y")';
    expect(parseXmlTree(manifest("E: application (line=5)", `  ${hiddenInRaw}`), "manifest")).toBeNull();
    expect(parseXmlTree(manifest("E: application (line=5)", `  ${valueFakesRaw}`), "no-namespace")).toBeNull();
    expect(parseXmlTree(manifest("E: application (line=5)", '  A: path="." (Raw: "..")'), "no-namespace")).toBeNull();
    expect(parseXmlTree(manifest("E: application (line=5)", '  A: path="a\\"b" (Raw: "a\\"b")'), "no-namespace")).toBeNull();
    expect(judgeManifestSurface(manifest("E: application (line=5)", `  ${hiddenInRaw}`)).length).toBeGreaterThan(0);
  });

  it("T3-23 extra: a manifest whose real allowBackup is replaced by the fake line fails the check", () => {
    const errors = judgeManifestSurface(manifest("E: application (line=5)", `  ${FAKE_BACKUP}`));
    expect(errors.length).toBeGreaterThan(0);
  });
});
