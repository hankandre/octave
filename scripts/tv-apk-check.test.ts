// @vitest-environment node
// T3-01 acceptance item 3: the APK contains arm64-v8a, declares the leanback launcher category and does not
// require a touchscreen. The rule is the pure checkBadging(text) over `aapt2 dump badging` output; the tv job
// applies it to the real APK before uploading it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

// Badging of a release APK built by the tv-play spike (aapt2 37.0.0), with the package renamed to Octave's and the
// per-locale label lines dropped.
const GOOD = readFileSync(join(repo, "scripts", "fixtures", "tv", "badging-release.txt"), "utf8");

type CheckBadging = (text: string) => string[];

async function loadCheckBadging(): Promise<CheckBadging> {
  const module = (await import("./tv-apk-check.mjs")) as { checkBadging: CheckBadging };
  return module.checkBadging;
}

function replaceOnce(text: string, from: string, to: string): string {
  expect(text).toContain(from);
  return text.replace(from, to);
}

function tvJob(): string[] {
  const lines = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8").split("\n");
  const start = lines.findIndex((line) => line === "  tv:");
  expect(start, "ci.yml has a job named tv").toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

const runStep = (command: string) => new RegExp(`^\\s+(?:- )?run: ${command.replace(/[.*+?^${}()|[\]\\:]/g, "\\$&")}\\s*$`);

describe("checkBadging", () => {
  it("T3-01 item 3: passes the badging of a TV release APK", async () => {
    const checkBadging = await loadCheckBadging();
    expect(checkBadging(GOOD)).toEqual([]);
  });

  it("T3-01 item 3: fails an APK without arm64-v8a and names the ABI", async () => {
    const checkBadging = await loadCheckBadging();
    const errors = checkBadging(replaceOnce(GOOD, "native-code: 'arm64-v8a' 'x86_64'", "native-code: 'x86_64'"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR tv apk: /);
    expect(errors[0]).toContain("arm64-v8a");
  });

  it("T3-01 item 3: fails an APK with no native code at all", async () => {
    const checkBadging = await loadCheckBadging();
    const errors = checkBadging(replaceOnce(GOOD, "native-code: 'arm64-v8a' 'x86_64'\n", ""));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR tv apk: .*arm64-v8a/);
  });

  it("T3-01 item 3: fails an APK with no leanback launchable activity, though it has a phone launcher", async () => {
    const checkBadging = await loadCheckBadging();
    const text = replaceOnce(GOOD, "leanback-launchable-activity: name='dev.octave.tv.MainActivity'  label='' icon='' banner=''\n", "");
    expect(text).toContain("launchable-activity: name='dev.octave.tv.MainActivity'");
    const errors = checkBadging(text);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR tv apk: /);
    expect(errors[0]).toMatch(/leanback/i);
  });

  it("T3-01 item 3: fails an APK that requires the touchscreen", async () => {
    const checkBadging = await loadCheckBadging();
    const errors = checkBadging(
      replaceOnce(GOOD, "  uses-feature-not-required: name='android.hardware.touchscreen'", "  uses-feature: name='android.hardware.touchscreen'"),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR tv apk: /);
    expect(errors[0]).toContain("touchscreen");
  });

  it("T3-01 item 3: fails an APK that leaves the touchscreen undeclared, so Android implies it is required", async () => {
    const checkBadging = await loadCheckBadging();
    const errors = checkBadging(
      replaceOnce(
        GOOD,
        "  uses-feature-not-required: name='android.hardware.touchscreen'",
        "  uses-feature: name='android.hardware.touchscreen'\n  uses-implied-feature: name='android.hardware.touchscreen' reason='default feature for all apps'",
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("touchscreen");
  });

  it("T3-01 item 3: fails an APK built with another application ID and names Octave's", async () => {
    const checkBadging = await loadCheckBadging();
    const errors = checkBadging(GOOD.replaceAll("cloud.jellyscale.octave", "dev.example.other"));
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toMatch(/^ERROR tv apk: /);
    expect(errors.join("\n")).toContain("cloud.jellyscale.octave");
  });

  it("T3-01 item 3: reports one line per missing fact", async () => {
    const checkBadging = await loadCheckBadging();
    let text = replaceOnce(GOOD, "native-code: 'arm64-v8a' 'x86_64'", "native-code: 'x86_64'");
    text = replaceOnce(text, "leanback-launchable-activity: name='dev.octave.tv.MainActivity'  label='' icon='' banner=''\n", "");
    text = replaceOnce(text, "  uses-feature-not-required: name='android.hardware.touchscreen'", "  uses-feature: name='android.hardware.touchscreen'");
    const errors = checkBadging(text);
    expect(errors).toHaveLength(3);
    for (const error of errors) expect(error).toMatch(/^ERROR tv apk: /);
  });

  it("T3-01 item 3: fails empty badging", async () => {
    const checkBadging = await loadCheckBadging();
    expect(checkBadging("").length).toBeGreaterThan(0);
  });
});

describe("the tv job builds, checks and uploads the APK", () => {
  it("T3-01 item 3: has the root scripts the job runs", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const name of ["tv:prebuild", "tv:build", "tv:apk:check"]) expect(pkg.scripts[name], name).toBeTruthy();
  });

  it("T3-01 item 3: prebuilds and builds in the tv job", () => {
    const job = tvJob();
    expect(job.some((line) => runStep("pnpm tv:prebuild").test(line))).toBe(true);
    expect(job.some((line) => runStep("pnpm tv:build").test(line))).toBe(true);
  });

  it("T3-01 item 3: checks the APK before the first upload-artifact step, which uploads octave-tv-release-apk", () => {
    const job = tvJob();
    const build = job.findIndex((line) => runStep("pnpm tv:build").test(line));
    const check = job.findIndex((line) => runStep("pnpm tv:apk:check").test(line));
    const upload = job.findIndex((line) => line.includes("actions/upload-artifact@"));
    expect(check, "a single-line step `run: pnpm tv:apk:check`").toBeGreaterThan(-1);
    expect(upload, "an actions/upload-artifact step").toBeGreaterThan(-1);
    expect(build).toBeLessThan(check);
    expect(check).toBeLessThan(upload);
    const nextStep = job.findIndex((line, i) => i > upload && /^\s+- /.test(line));
    const uploadStep = job.slice(upload, nextStep === -1 ? undefined : nextStep).join("\n");
    expect(uploadStep).toMatch(/name: octave-tv-release-apk\s*$/m);
    expect(uploadStep).toMatch(/if-no-files-found: error/);
  });
});
