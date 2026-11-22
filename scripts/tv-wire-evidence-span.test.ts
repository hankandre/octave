// @vitest-environment node
// T3-26 review: a second secret that spans "?", "&" or "=" is replaced even when another secret holds in one part.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const wire = JSON.parse(readFileSync(join(repo, "apps", "tv", "src", "e2e", "wire", "wire-tests.json"), "utf8")) as { canary: string };
type Evidence = {
  STAND_IN: string;
  safeUrlParts: (url: string, secrets: string[]) => { path: string; queryNames: string[]; secretInUrl: boolean };
};
const load = async () => (await import(pathToFileURL(join(repo, "scripts/tv-wire-evidence.mjs")).href)) as Evidence;
const TOKEN = "tok-9f8e7d6c5b4a3210";
const SPAN = "span-left?span-right";

describe("T3-26 review: a spanning secret next to another secret", () => {
  it("replaces the path and every name for a spanning secret when the token is also in the URL", async () => {
    const { STAND_IN, safeUrlParts } = await load();
    const parts = safeUrlParts(`/Items/span-left?span-right=1&v=${TOKEN}`, [SPAN, TOKEN]);
    expect(parts.path).toBe(STAND_IN);
    expect(parts.queryNames).toEqual([STAND_IN, STAND_IN]);
    expect(parts.secretInUrl).toBe(true);
  });

  it("does the same for the canary, which holds an equals sign", async () => {
    const { STAND_IN, safeUrlParts } = await load();
    const parts = safeUrlParts(`/Items?${wire.canary}=1&b=${TOKEN}`, [wire.canary, TOKEN]);
    expect(parts.path).toBe(STAND_IN);
    expect(parts.queryNames.every((name) => name === STAND_IN)).toBe(true);
  });

  it("still keeps the path and names when the only secret is in a value", async () => {
    const { safeUrlParts } = await load();
    const parts = safeUrlParts(`/Items?limit=5&v=${TOKEN}`, [SPAN, TOKEN]);
    expect(parts.path).toBe("/Items");
    expect(parts.queryNames).toEqual(["limit", "v"]);
  });
});
