// T8-03 item 9 (D9): the player module's typed declaration and the app adapter's parameter are one shape. `pnpm typecheck`
// holds `joined` below; the Jest case holds that no file reaches the same result through a cast.
import { describe, expect, it } from "@jest/globals";
import type { createPlayerEngine } from "./player-engine";
import type { loadPlayerModule } from "./player-module";

function joined(module: ReturnType<typeof loadPlayerModule>): Parameters<typeof createPlayerEngine>[0] {
  return module;
}
// Only its type matters; this keeps it from being an unused local.
void joined;

// apps/tv has no Node type definitions, so what the scan calls is typed here.
declare const __dirname: string;
declare const __filename: string;
const { readdirSync, readFileSync } = require("fs") as {
  readdirSync(dir: string, options: { withFileTypes: true }): { name: string; isFile(): boolean; isDirectory(): boolean }[];
  readFileSync(path: string, encoding: "utf8"): string;
};
const { join, relative } = require("path") as { join(...parts: string[]): string; relative(from: string, to: string): string };

const SOURCE_ROOT = join(__dirname, "..");
const CASTS: RegExp[] = [/\bas\s+unknown\s+as\s+PlayerNative\b/, /\bas\s+unknown\s+as\s+OctavePlayerNative\b/, /\bas\s+PlayerNative\b/];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && path !== __filename ? [path] : [];
  });
}

describe("T8-03 item 9: the player module joins the adapter without a cast", () => {
  it("T8-03 item 9: no file under apps/tv/src casts the player module to the adapter's shape", () => {
    const files = sourceFiles(SOURCE_ROOT);
    expect(files.map((file) => relative(SOURCE_ROOT, file))).toEqual(
      expect.arrayContaining(["host/host-gateway.ts", "e2e/wire/run-wire.ts", "e2e/wire/player-run.ts"]),
    );
    const casting = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return CASTS.some((cast) => cast.test(text));
    });
    expect(casting.map((file) => relative(SOURCE_ROOT, file))).toEqual([]);
  });
});
