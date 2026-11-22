// @vitest-environment node
// T3-24 review fix (docs/specs/T3-24.md, "The rule as built", P1): no decoding round may hold a ? or #. A proxy that
// decodes the path once and then splits off a query or fragment would read /jf/Items/..%3f/x as the path /jf/Items/..,
// which climbs out of the base path. RequestPath.kt holds the same cases (EscapedQueryFragmentPathTest.kt).
import { describe, expect, it } from "vitest";
import { isSafeRequestPath } from "./request-path";

describe("isSafeRequestPath and a ? or # in a decoding round", () => {
  it.each([
    "/Items/..%3f/x",
    "/Items/..%3F/x",
    "/Items/..%23/x",
    "/Items/..%253f/x",
    "/Items/..%25253F/x",
    "/Items/%2e%2e%3f",
    "/Items/%2e%2e%23x",
    "/Items/a%3fb",
    "/Items/a%23b",
  ])("refuses %s", (path) => {
    expect(isSafeRequestPath(path)).toBe(false);
  });

  it.each(["/Items/?x", "/Items/#x"])("still refuses %s as written", (path) => {
    expect(isSafeRequestPath(path)).toBe(false);
  });

  it.each(["/Items/a%3Ab", "/Items/100%25", "/Items/item%2Fwith%20slash/Similar", "/Items/3f/23"])("accepts the near miss %s", (path) => {
    expect(isSafeRequestPath(path)).toBe(true);
  });
});
