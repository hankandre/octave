// @vitest-environment node
// T3-31 review finding: each check of the e2e APK is called with the e2e APK and mapping only, so no extra rows or lists reach it.
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ dex: [] as unknown[][], inspector: [] as unknown[][], native: [] as unknown[][] }));
vi.mock("./tv-apk-dex.mjs", () => ({ main: (...a: unknown[]) => (calls.dex.push(a), 0) }));
vi.mock("./tv-apk-inspector.mjs", () => ({ main: (...a: unknown[]) => (calls.inspector.push(a), 0) }));
vi.mock("./tv-apk-native-inspector.mjs", () => ({ main: (...a: unknown[]) => (calls.native.push(a), 0) }));

describe("T3-31 review", () => {
  it("each check gets exactly the e2e APK and mapping, with no second argument", async () => {
    const { checkE2eApk } = await import("./tv-e2e-apk.mjs");
    expect(await checkE2eApk({ apk: "e.apk", mapping: "e.map" })).toEqual([]);
    expect(calls.dex).toEqual([[["e.apk", "e.map"]]]);
    expect(calls.inspector).toEqual([[["e.apk", "e.map"]]]);
    expect(calls.native).toEqual([[["e.apk"]]]);
  });
});
