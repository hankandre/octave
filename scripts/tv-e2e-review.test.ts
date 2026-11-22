// @vitest-environment node
// T3-31 review finding: the default mapping path of `pnpm tv:e2e` is the e2e build's, never the release mapping.
import { describe, expect, it } from "vitest";
import { E2E_MAPPING } from "./tv-build.mjs";
import { e2eMappingPath } from "./tv-e2e.mjs";

describe("T3-31 review", () => {
  it("the default mapping is the e2e build's, never the release mapping or undefined", () => {
    expect(e2eMappingPath(["a.apk", "p.apk"])).toBe(E2E_MAPPING);
    expect(e2eMappingPath([])).toBe(E2E_MAPPING);
    expect(e2eMappingPath(["a.apk", "p.apk", "m.txt"])).toBe("m.txt");
    expect(e2eMappingPath([])).not.toContain("outputs/mapping");
  });
});
