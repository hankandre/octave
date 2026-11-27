// @vitest-environment node
// T17-01 item 3, from the review round: what the web boundary run must refuse and what it must not require.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 60_000;
const TSCONFIG = JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler", target: "ES2023", noEmit: true } });
const CLEAN: Record<string, string> = {
  "apps/web/src/ok.ts": "export const ok = 1;\n",
  "packages/web-host/src/index.ts": "export const host = 1;\n",
};
const roots: string[] = [];

function lintTree(files: Record<string, string>): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), "octave-web-boundaries-"));
  roots.push(root);
  for (const [path, text] of Object.entries({ "tsconfig.json": TSCONFIG, ...CLEAN, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const child = spawnSync(process.execPath, ["scripts/lint-web-boundaries.mjs", "--root", root], { cwd: repo, encoding: "utf8" });
  return { status: child.status, output: `${child.stdout}\n${child.stderr}` };
}

const importing = (specifier: string) => `import * as found from "${specifier}";\nexport const bad = found;\n`;

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("T17-01 item 3: the web boundary run", () => {
  it.each([
    ["apps/web/lib/x.ts", "../lib/x"],
    ["apps/web/public/script.js", "../public/script.js"],
    ["apps/web/helper.mts", "../helper.mts"],
  ])(
    "refuses app code that reaches %s, outside src/",
    (target, specifier) => {
      const { status, output } = lintTree({ [target]: "export const outside = 1;\n", "apps/web/src/bad.ts": importing(specifier) });
      expect(status, output).not.toBe(0);
      expect(output).toContain(`${target} is outside apps/web/src`);
    },
    TIMEOUT,
  );

  it(
    "does not require a declaration file to be read",
    () => {
      const { status, output } = lintTree({
        "apps/web/src/env.d.ts": "declare const buildName: string;\n",
        "packages/web-host/src/types.d.mts": "export type Host = number;\n",
      });
      expect(output).toMatch(/2\/2 source files/);
      expect(status, output).toBe(0);
    },
    TIMEOUT,
  );
});
