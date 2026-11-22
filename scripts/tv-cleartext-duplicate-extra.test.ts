// @vitest-environment node
// T3-23 (docs/specs/T3-23.md, Two bases), not frozen: T3-15's two aapt2 readers fail on an element with two attributes
// of one local name, so a second value cannot hide behind the first. The lines are as `aapt2 dump xmltree` prints them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { judgeNetworkSecurity, readManifestNetworkSecurity } from "./tv-apk-check.mjs";
import { readXmlTree } from "./tv-aapt2-xml.mjs";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/tv/${name}`, import.meta.url), "utf8");
const ANDROID = "http://schemas.android.com/apk/res/android";

describe("T3-23 extra: network security readers fail on a duplicate attribute", () => {
  it("T3-23 extra: a second usesCleartextTraffic in the manifest fails the judge", () => {
    const text = fixture("xmltree-manifest-release.txt").replace(
      /^(\s+)(A: http:\/\/schemas\.android\.com\/apk\/res\/android:networkSecurityConfig.*)$/m,
      `$1A: ${ANDROID}:usesCleartextTraffic(0x010104ec)=true\n$1A: ${ANDROID}:usesCleartextTraffic(0x010104ec)=false\n$1$2`,
    );
    const facts = readManifestNetworkSecurity(text);
    expect(facts.problems).toHaveLength(1);
    expect(facts.problems[0]).toMatch(/^application \(line=\d+\) has two attributes named usesCleartextTraffic$/);
    const tree = readXmlTree(fixture("xmltree-network-security-config.txt"), "any-namespace").tree;
    const errors = judgeNetworkSecurity({ ...facts, configFile: "res/c-.xml", tree });
    expect(errors).toContain(`ERROR tv apk: ${facts.problems[0]}`);
  });

  it("T3-23 extra: a second cleartextTrafficPermitted in the configuration fails the judge, in any namespace", () => {
    const text = fixture("xmltree-network-security-config.txt").replace(
      /^(\s+)(A: cleartextTrafficPermitted=true.*)$/m,
      `$1$2\n$1A: http://example.com/x:cleartextTrafficPermitted=false`,
    );
    const { tree, problems } = readXmlTree(text, "any-namespace");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^base-config \(line=\d+\) has two attributes named cleartextTrafficPermitted$/);
    const facts = { ...readManifestNetworkSecurity(fixture("xmltree-manifest-release.txt")), configFile: "res/c-.xml", tree, problems };
    expect(judgeNetworkSecurity(facts)).toContain(`ERROR tv apk: ${problems[0]}`);
  });
});
