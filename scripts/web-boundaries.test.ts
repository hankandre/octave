// @vitest-environment node
// T17-01 item 3: `pnpm lint:boundaries` fails an import into apps/web or packages/web-host from apps/tv, modules or
// react-native, and an import of packages/web-host from packages/core.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Each case spawns dependency-cruiser; the default 5 s is too tight on CI.
const TIMEOUT = 60_000;
const WEB_SUMMARY = /source files under apps\/web\/src and packages\/web-host\/src/;

const TSCONFIG = JSON.stringify({
  compilerOptions: { module: "ESNext", moduleResolution: "Bundler", target: "ES2023", jsx: "react-jsx", strict: true, noEmit: true },
});

// The clean tree: the app may import the host.
const CLEAN: Record<string, string> = {
  "apps/web/src/ok.tsx": 'import { host } from "../../../packages/web-host/src/index";\nexport const ok = host;\n',
  "packages/web-host/src/index.ts": "export const host = 1;\n",
};

// What a forbidden import points at exists, so a refusal comes from the rule and not from a missing file.
const TARGETS: Record<string, string> = {
  "apps/tv/src/x.ts": "export const x = 1;\nexport type X = { x: number };\n",
  "modules/session/src/index.ts": "export const session = 1;\n",
};

const roots: string[] = [];

function makeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "octave-web-boundaries-"));
  roots.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function run(command: string, args: string[]): { status: number | null; output: string } {
  const child = spawnSync(command, args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: child.status, output: `${child.stdout ?? ""}\n${child.stderr ?? ""}` };
}

const lint = (script: string, root: string) => run(process.execPath, [script, "--root", root]);

function expectRefused(files: Record<string, string>, rule: string): void {
  const { status, output } = lint("scripts/lint-web-boundaries.mjs", makeTree({ ...CLEAN, ...TARGETS, ...files }));
  expect(status, output).not.toBe(0);
  expect(output).toContain(rule);
}

const importing = (specifier: string) => `import * as found from "${specifier}";\nexport const bad = found;\n`;

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe("T17-01 item 3: the web form's import boundaries", () => {
  it(
    "accepts a clean tree, where the app imports the host, and reads its files",
    () => {
      const { status, output } = lint("scripts/lint-web-boundaries.mjs", makeTree({ ...CLEAN, ...TARGETS }));
      expect(output).toMatch(/2\/2 source files under apps\/web\/src and packages\/web-host\/src/);
      expect(status, output).toBe(0);
    },
    TIMEOUT,
  );

  it.each([
    ["apps/web importing apps/tv", "apps/web/src/bad.ts", "../../tv/src/x"],
    ["apps/web importing modules", "apps/web/src/bad.ts", "../../../modules/session/src/index"],
    ["packages/web-host importing apps/tv", "packages/web-host/src/bad.ts", "../../../apps/tv/src/x"],
    ["packages/web-host importing modules", "packages/web-host/src/bad.ts", "../../../modules/session/src/index"],
  ])("refuses %s", (_name, path, specifier) => expectRefused({ [path]: importing(specifier) }, "web-not-from-tv"), TIMEOUT);

  it(
    "refuses a type-only import of apps/tv from apps/web",
    () => expectRefused({ "apps/web/src/bad.ts": 'import type { X } from "../../tv/src/x";\nexport type Bad = X;\n' }, "web-not-from-tv"),
    TIMEOUT,
  );

  it.each(["tv", "session", "player", "artwork", "install-id", "preferences"])(
    "refuses an import of the TV's workspace package @octave/%s, which apps/web has not declared",
    (name) => expectRefused({ "apps/web/src/bad.ts": importing(`@octave/${name}`) }, "web-not-from-tv"),
    TIMEOUT,
  );

  it.each([
    ["apps/web/src/bad.ts", "react-native"],
    ["apps/web/src/bad.ts", "@react-native/assets-registry"],
    ["apps/web/src/bad.ts", "expo"],
    ["apps/web/src/bad.ts", "@expo/vector-icons"],
    ["packages/web-host/src/bad.ts", "react-native"],
    ["packages/web-host/src/bad.ts", "expo-crypto"],
  ])("refuses in %s an import of %s", (path, specifier) => expectRefused({ [path]: importing(specifier) }, "web-no-native-platform"), TIMEOUT);

  it(
    "refuses an import that resolves to nothing, so a mistyped path into the TV cannot slip through",
    () => expectRefused({ "apps/web/src/bad.ts": importing("./no-such-file") }, "web-no-unresolvable"),
    TIMEOUT,
  );

  it(
    "refuses packages/web-host importing apps/web",
    () => expectRefused({ "packages/web-host/src/bad.ts": importing("../../../apps/web/src/ok") }, "web-host-not-from-app"),
    TIMEOUT,
  );

  it(
    "refuses a cycle inside apps/web",
    () =>
      expectRefused(
        {
          "apps/web/src/first.ts": 'import { second } from "./second";\nexport const first = () => second;\n',
          "apps/web/src/second.ts": 'import { first } from "./first";\nexport const second = () => first;\n',
        },
        "no-circular",
      ),
    TIMEOUT,
  );

  it(
    "fails a run that read nothing, because apps/web/src is missing",
    () => {
      const { status, output } = lint(
        "scripts/lint-web-boundaries.mjs",
        makeTree({ "packages/web-host/src/index.ts": "export const host = 1;\n" }),
      );
      expect(status, output).not.toBe(0);
      expect(output).toMatch(/lint:boundaries|apps\/web\/src/);
      expect(output).not.toMatch(/Cannot find module/);
    },
    TIMEOUT,
  );

  it(
    "refuses the core importing packages/web-host",
    () => {
      const { status, output } = lint(
        "scripts/lint-boundaries.mjs",
        makeTree({
          "packages/core/src/bad.ts": importing("../../web-host/src/index"),
          "packages/web-host/src/index.ts": "export const host = 1;\n",
        }),
      );
      expect(status, output).not.toBe(0);
      expect(output).toContain("core-is-platform-free");
    },
    TIMEOUT,
  );

  it(
    "pnpm lint:boundaries passes on the repository and reads both the core and the web form",
    () => {
      const { status, output } = run("pnpm", ["lint:boundaries"]);
      expect(output).toMatch(/source files under packages\/core\/src/);
      expect(output).toMatch(WEB_SUMMARY);
      expect(status, output).toBe(0);
    },
    TIMEOUT * 2,
  );
});
