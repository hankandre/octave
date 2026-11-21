// @vitest-environment node
// T3-01 acceptance item 6: nothing in apps/tv closes the door on tvOS. ESLint refuses Android-only react-native exports
// and direct native-module access in shared TypeScript, and every `*.android.*` file needs a sibling the tvOS build can
// load. findOrphanPlatformFiles(paths: string[]) -> string[] returns the orphan paths, in input order.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Each case spawns ESLint; the default 5 s is too tight.
const TIMEOUT = 60_000;
const ESLINT = ["--import", "./scripts/typescript-6-resolve.mjs", "node_modules/eslint/bin/eslint.js", "--max-warnings", "0"];

function eslintStdin(path: string, code: string): { status: number | null; output: string } {
  const child = spawnSync(process.execPath, [...ESLINT, "--stdin", "--stdin-filename", path], {
    cwd: repo,
    input: code,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: child.status, output: `${child.stdout ?? ""}\n${child.stderr ?? ""}` };
}

type FindOrphans = (paths: string[]) => string[];

async function loadFindOrphans(): Promise<FindOrphans> {
  const module = (await import("./check-tv-platform.mjs")) as { findOrphanPlatformFiles: FindOrphans };
  return module.findOrphanPlatformFiles;
}

const SHARED = "apps/tv/src/probe.tsx";
const PLATFORM = "apps/tv/src/probe.android.tsx";

const banned: [string, string][] = [
  ["ToastAndroid", 'import { ToastAndroid } from "react-native";\nexport const toast = ToastAndroid;\n'],
  ["PermissionsAndroid", 'import { PermissionsAndroid } from "react-native";\nexport const ask = PermissionsAndroid;\n'],
  ["NativeModules", 'import { NativeModules } from "react-native";\nexport const modules = NativeModules;\n'],
  ["requireNativeModule from expo-modules-core", 'import { requireNativeModule } from "expo-modules-core";\nexport const probe = requireNativeModule("Probe");\n'],
  ["requireNativeModule from expo", 'import { requireNativeModule } from "expo";\nexport const probe = requireNativeModule("Probe");\n'],
];

describe("platform lint", () => {
  it.each(banned)(
    "T3-01 item 6: rejects %s in shared TypeScript and names the platform file",
    (_name, code) => {
      const { status, output } = eslintStdin(SHARED, code);
      expect(status).not.toBe(0);
      expect(output).toMatch(/error/);
      expect(output).toMatch(/\.android\.ts/);
    },
    TIMEOUT,
  );

  it.each(banned)(
    "T3-01 item 6: accepts %s in an .android.tsx file",
    (_name, code) => {
      const { status, output } = eslintStdin(PLATFORM, code);
      expect(output).not.toMatch(/error|warning/);
      expect(status).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "T3-01 item 6: accepts portable react-native code with JSX in shared TypeScript",
    () => {
      const code = 'import { Pressable, View } from "react-native";\nexport function Probe() {\n  return (\n    <View>\n      <Pressable focusable />\n    </View>\n  );\n}\n';
      const { status, output } = eslintStdin(SHARED, code);
      expect(output).not.toMatch(/error|warning/);
      expect(status).toBe(0);
    },
    TIMEOUT,
  );

  it("T3-01 item 6: runs pnpm lint over apps/tv", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: { lint: string } };
    expect(pkg.scripts.lint.split(/\s+/)).toContain("apps/tv");
  });
});

describe("findOrphanPlatformFiles", () => {
  it("T3-01 item 6: reports an .android.tsx file with no sibling", async () => {
    const find = await loadFindOrphans();
    expect(find(["apps/tv/src/player/remote.android.tsx", "apps/tv/src/App.tsx"])).toEqual(["apps/tv/src/player/remote.android.tsx"]);
  });

  it("T3-01 item 6: accepts an .android.tsx file with a base file beside it", async () => {
    const find = await loadFindOrphans();
    expect(find(["apps/tv/src/player/remote.android.tsx", "apps/tv/src/player/remote.tsx"])).toEqual([]);
  });

  it("T3-01 item 6: accepts an .android.ts file with an .ios.ts file beside it", async () => {
    const find = await loadFindOrphans();
    expect(find(["apps/tv/src/toast.android.ts", "apps/tv/src/toast.ios.ts"])).toEqual([]);
  });

  it("T3-01 item 6: does not count a base file in another directory as a sibling", async () => {
    const find = await loadFindOrphans();
    expect(find(["apps/tv/src/a/remote.android.tsx", "apps/tv/src/b/remote.tsx"])).toEqual(["apps/tv/src/a/remote.android.tsx"]);
  });

  it("T3-01 item 6: does not count another .android file as a sibling", async () => {
    const find = await loadFindOrphans();
    expect(find(["apps/tv/src/remote.android.tsx", "apps/tv/src/remote.android.ts"])).toEqual([
      "apps/tv/src/remote.android.tsx",
      "apps/tv/src/remote.android.ts",
    ]);
  });

  it("T3-01 item 6: finds no orphan platform file in the real apps/tv tree", async () => {
    const find = await loadFindOrphans();
    // Generated trees sit at the app root only; node_modules is skipped at any depth.
    const generated = new Set(["android", "ios", ".expo", "dist"]);
    const app = join(repo, "apps", "tv");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === "node_modules" || (dir === app && generated.has(entry.name))) return [];
        const path = join(dir, entry.name);
        return entry.isDirectory() ? walk(path) : [relative(repo, path)];
      });
    expect(existsSync(join(app, "src")), "apps/tv/src exists").toBe(true);
    const paths = walk(app);
    expect(paths.some((path) => /\.tsx?$/.test(path))).toBe(true);
    expect(find(paths)).toEqual([]);
  });
});
