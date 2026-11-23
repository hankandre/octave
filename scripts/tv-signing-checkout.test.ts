// @vitest-environment node
// T3-21 review fixes: the key and its properties file stay outside every checkout, and the Gradle helper says so too.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signingProblems } from "./tv-signing.mjs";

const require = createRequire(import.meta.url);
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "octave-checkout-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function keyIn(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "k.jks"), "x");
  const properties = join(dir, "k.properties");
  writeFileSync(properties, "storeFile=k.jks\nstorePassword=a\nkeyAlias=b\nkeyPassword=a\n");
  return properties;
}

describe("a key inside a sibling checkout", () => {
  it("T3-21 review: signingProblems refuses a properties file under any directory that holds .git", () => {
    const sibling = join(root, "sibling");
    mkdirSync(join(sibling, ".git"), { recursive: true });
    const properties = keyIn(join(sibling, "keys"));
    const problems = signingProblems({ OCTAVE_SIGNING_PROPERTIES: properties }, { repoRoot: join(root, "elsewhere") });
    expect(problems.join("\n")).toMatch(/inside the repository/);
  });

  it("T3-21 review: the Gradle helper refuses it as well", () => {
    const plugin = require("../apps/tv/plugins/with-release-signing.js") as { addReleaseSigning(c: string, o: { applicationId: string }): string };
    const out = plugin.addReleaseSigning("android {\n    signingConfigs {\n        debug {\n        }\n    }\n    buildTypes {\n        release {\n            signingConfig signingConfigs.debug\n        }\n    }\n}\n", { applicationId: "a.b" });
    expect(out).toContain("octaveInCheckout");
    expect(out).toContain("names a file inside a checkout");
    expect(out).toContain("storeFile is inside a checkout");
  });
});

describe("the throwaway key's files are ignored", () => {
  it("T3-21 review: git ignores the throwaway properties file", () => {
    const repo = join(__dirname, "..");
    expect(spawnSync("git", ["check-ignore", "-q", "octave-throwaway.properties"], { cwd: repo }).status).toBe(0);
  });
});
