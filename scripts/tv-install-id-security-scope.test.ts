// @vitest-environment node
// T4-09 review fix (medium): docs/security.md section 6 must not present the install-id stage's clear=new and
// backup=refused results as proven on the CI image while only the implementer's own emulator has run the stage.
// When the pull request's octave-tv-evidence artifact holds the ran-stage line, the Ship step rewords the bullet and
// this test together.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..");

function installIdBullet(): string {
  const text = readFileSync(join(repo, "docs", "security.md"), "utf8");
  const bullet = text.split("\n").find((line) => line.startsWith("- The install id is one file, `octave-install-id`"));
  expect(bullet, "docs/security.md section 6 has the install-id bullet").toBeDefined();
  return bullet ?? "";
}

describe("T4-09 review: the install-id stage's results are scoped to the run that produced them", () => {
  it("says the Tested claims come from one run on the implementer's own emulator", () => {
    const bullet = installIdBullet();
    expect(bullet).toMatch(/\*\*Tested\*\* once, on the implementer's own API 36 emulator/);
    expect(bullet).not.toMatch(/\*\*Tested\*\* on the emulator by/);
  });

  it("marks the CI image as Tested now that the pull request's artifact holds the ran-stage line", () => {
    const bullet = installIdBullet();
    expect(bullet).toMatch(/On the CI image both are \*\*Tested\*\* too/);
    expect(bullet).not.toContain("Planned (T4-09)");
    expect(bullet).toContain("relaunch=same clear=new restore=new transport=selected backup=refused");
    expect(bullet).toContain("release-evidence/tv/e2e-install-id.txt");
    expect(bullet).toContain("octave-tv-evidence");
  });
});
