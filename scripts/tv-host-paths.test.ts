// @vitest-environment node
// T3-37 item 3 (docs/specs/T3-37.md, "Host paths"): the SDK path in scripts/tv-android-sdk.mjs's errors and the APK path
// are printed repository-relative, or with the home directory as `~`, so no console or CI log holds a home directory
// name. The home directory in every test is a temporary one, passed as an argument or as HOME to a child process; the
// real home is never used.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = join(repo, "scripts");
const TIMEOUT = 60_000;

type PathsModule = {
  shownPath(path: string, options?: { repo?: string; home?: string }): string;
  hideHostPaths(text: string, options?: { repo?: string; home?: string }): string;
};
const load = async (): Promise<PathsModule> => (await import(pathToFileURL(join(scripts, "tv-host-paths.mjs")).href)) as PathsModule;

const temps: string[] = [];
const tempHome = () => {
  const dir = mkdtempSync(join(tmpdir(), "octave-home-"));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("T3-37 item 3: shownPath and hideHostPaths", () => {
  const options = { repo: "/srv/octave", home: "/home/tester" };

  it("T3-37 item 3: a repository path is repository-relative", async () => {
    expect((await load()).shownPath("/srv/octave/apps/tv/app.apk", options)).toBe("apps/tv/app.apk");
  });

  it("T3-37 item 3: a path in the home directory starts with ~", async () => {
    const { shownPath } = await load();
    expect(shownPath("/home/tester/Android/Sdk", options)).toBe("~/Android/Sdk");
    expect(shownPath("/home/tester", options)).toBe("~");
  });

  it("T3-37 item 3: a path outside both stays, and a sibling that shares the prefix is no part of the home directory", async () => {
    const { shownPath } = await load();
    expect(shownPath("/tmp/x.apk", options)).toBe("/tmp/x.apk");
    expect(shownPath("/home/tester2/x", options)).toBe("/home/tester2/x");
    expect(shownPath("/srv/octave2/x", options)).toBe("/srv/octave2/x");
  });

  it("T3-37 item 3: a home directory of / changes nothing", async () => {
    const { shownPath, hideHostPaths } = await load();
    expect(shownPath("/etc/x.apk", { repo: "/srv/octave", home: "/" })).toBe("/etc/x.apk");
    expect(hideHostPaths("see /etc/x.apk", { repo: "/srv/octave", home: "/" })).toBe("see /etc/x.apk");
  });

  it("T3-37 item 3: free text has every occurrence replaced, quoted ones and one at the end of the text included", async () => {
    const { hideHostPaths } = await load();
    expect(hideHostPaths("no APK at /home/tester/a.apk, '/home/tester/a.apk' and /srv/octave/b/c.apk in /home/tester", options)).toBe("no APK at ~/a.apk, '~/a.apk' and b/c.apk in ~");
    expect(hideHostPaths("kept /home/tester2/x and /tmp/y", options)).toBe("kept /home/tester2/x and /tmp/y");
  });
});

// Runs a module function in a child process whose HOME is `home`, so the module's own default home is the temporary one.
function inChild(home: string, code: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, HOME: home }, timeout: 50_000 });
}

describe("T3-37 item 3: the SDK errors", () => {
  const sdkUrl = pathToFileURL(join(scripts, "tv-android-sdk.mjs")).href;
  const message = (home: string, body: string) => {
    const child = inChild(home, `import * as sdk from ${JSON.stringify(sdkUrl)}; try { ${body} } catch (error) { console.log(error.message); }`);
    return child.stdout;
  };

  it("T3-37 item 3: androidSdk names a missing ANDROID_HOME under the home directory with ~", () => {
    const home = tempHome();
    const text = message(home, `sdk.androidSdk({ ANDROID_HOME: ${JSON.stringify(join(home, "missing"))} });`);
    expect(text).toContain("~/missing");
    expect(text).not.toContain(home);
  }, TIMEOUT);

  it("T3-37 item 3: newestBuildTool and platformTool name the SDK under the home directory with ~", () => {
    const home = tempHome();
    const root = join(home, "sdk");
    mkdirSync(root);
    const build = message(home, `sdk.newestBuildTool(${JSON.stringify(root)}, "aapt2");`);
    expect(build).toContain("~/sdk/build-tools");
    expect(build).not.toContain(home);
    const platform = message(home, `sdk.platformTool(${JSON.stringify(root)}, "adb");`);
    expect(platform).toContain("~/sdk/platform-tools");
    expect(platform).not.toContain(home);
  }, TIMEOUT);
});

describe("T3-37 item 3: the APK path in the apk checks", () => {
  for (const script of ["tv-apk-check.mjs", "tv-apk-native-inspector.mjs"]) {
    it(`T3-37 item 3: ${script} prints a missing APK under the home directory as ~/missing.apk`, () => {
      const home = tempHome();
      const child = spawnSync(process.execPath, [join(scripts, script), join(home, "missing.apk")], { encoding: "utf8", env: { ...process.env, HOME: home }, timeout: 50_000 });
      const output = `${child.stdout}\n${child.stderr}`;
      expect(child.status, output).toBe(1);
      expect(output).toContain("~/missing.apk");
      expect(output).not.toContain(home);
    }, TIMEOUT);
  }

  it("T3-37 item 3: tv-apk-native-inspector.mjs prints its L0 line for a file that is no zip without the home directory", () => {
    const home = tempHome();
    const apk = join(home, "bad.apk");
    writeFileSync(apk, "not a zip");
    const child = spawnSync(process.execPath, [join(scripts, "tv-apk-native-inspector.mjs"), apk], { encoding: "utf8", env: { ...process.env, HOME: home }, timeout: 50_000 });
    const output = `${child.stdout}\n${child.stderr}`;
    expect(child.status, output).toBe(1);
    expect(output).toMatch(/L0 ~\/bad\.apk cannot be read as a zip/);
    expect(output).not.toContain(home);
  }, TIMEOUT);
});

describe("T3-37 item 3: adb's own text", () => {
  it("T3-37 item 3: a failed install that names the APK under the home directory shows ~ in the runner's result", () => {
    const home = tempHome();
    const dir = tempHome();
    const adb = join(dir, "adb");
    const apk = join(home, "app.apk");
    writeFileSync(adb, [`#!${process.execPath}`, `process.stderr.write(${JSON.stringify(`adb: failed to install ${apk}: Failure [INSTALL_FAILED_TEST]\n`)}); process.exitCode = 1;`, ""].join("\n"));
    chmodSync(adb, 0o755);
    const adbUrl = pathToFileURL(join(scripts, "tv-adb.mjs")).href;
    const child = inChild(
      home,
      `import { openAdb } from ${JSON.stringify(adbUrl)}; const r = openAdb({ adbPath: ${JSON.stringify(adb)}, serial: "emulator-5554" }).run(["install", ${JSON.stringify(apk)}]); console.log(JSON.stringify(r));`,
    );
    const result = JSON.parse(child.stdout) as { status: number; stderr: string };
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("~/app.apk");
    expect(result.stderr).not.toContain(home);
  }, TIMEOUT);
});

describe("T3-37 item 3: no script prints a raw path", () => {
  it("T3-37 item 3: no scripts/tv-*.mjs interpolates ${apk}, ${probeApk}, ${mapping} or ${mappingPath} as it is", () => {
    const names = readdirSync(scripts).filter((name) => /^tv-.*\.mjs$/.test(name));
    expect(names.length).toBeGreaterThanOrEqual(42);
    const offenders: string[] = [];
    for (const name of names) {
      readFileSync(join(scripts, name), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/\$\{(apk|probeApk|mapping|mappingPath)\}/.test(line)) offenders.push(`${name}:${index + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
