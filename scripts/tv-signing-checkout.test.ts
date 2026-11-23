// @vitest-environment node
// T3-21 review fixes: the key and its properties file stay outside every checkout, and the Gradle helper says so too.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("CI's throwaway key step fails when the key cannot be made", () => {
  const repo = join(__dirname, "..");

  it("T3-21 review: --throwaway exits 1 and prints no path when keytool is not on PATH", () => {
    const result = spawnSync(process.execPath, [join(repo, "scripts", "tv-signing.mjs"), "--throwaway", join(root, "key")], {
      encoding: "utf8",
      env: { PATH: join(root, "no-tools") },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^ERROR tv signing: keytool failed/);
  });

  it("T3-21 review: both jobs assign the path before they write it, so a failed command fails the step", () => {
    const workflow = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8");
    const calls = workflow.split("\n").filter((line) => line.includes("tv-signing.mjs --throwaway"));
    expect(calls).toHaveLength(2);
    for (const line of calls) {
      expect(line.trim()).toMatch(/^properties=\$\(node scripts\/tv-signing\.mjs --throwaway "\$RUNNER_TEMP\/octave-signing"\)$/);
    }
    expect(workflow.match(/^\s*echo "OCTAVE_SIGNING_PROPERTIES=\$properties" >> "\$GITHUB_ENV"$/gm)).toHaveLength(2);
  });
});

describe("the throwaway key's files are ignored", () => {
  it("T3-21 review: git ignores the throwaway properties file", () => {
    const repo = join(__dirname, "..");
    expect(spawnSync("git", ["check-ignore", "-q", "octave-throwaway.properties"], { cwd: repo }).status).toBe(0);
  });
});
