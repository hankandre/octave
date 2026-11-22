// @vitest-environment node
// T3-24 (docs/specs/T3-24.md, "The rule as built"): the forms the T3-16 path rule still passed. The core's half of
// items 1 to 3 holds the same paths as the Kotlin classes SemicolonAndControlPathTest, DotLikeSegmentPathTest and
// DecodingRoundsPathTest; item 5 holds the shared fixture to "The vectors" and runs every vector of it, and every path
// of items 1 to 3, so the manifest's one core run reaches each of them (spec-check note 2).
//
// - Item 1: a ; (P6) or a control character, U+0000 to U+001F or U+007F to U+009F (P3), as written or after any round
//   of percent-decoding, is refused.
// - Item 2: a segment made only of dots and the nine dot-like characters, at least one dot-like (P4), as written or
//   after any round, is refused; a dot-like character beside another character is not.
// - Item 3: an escape run that is not UTF-8 in any round (P5), and an escape still present after the fourth decoding
//   (P7), are refused; four rounds around a letter and a literal % are not.
import { describe, expect, it } from "vitest";
import vectors from "../../tests/fixtures/request-paths.json";
import { isSafeRequestPath } from "./request-path";

// The nine dot-like characters of the spec, by code point, with their UTF-8 escapes.
const DOT_LIKE: [string, string][] = [
  ["․", "%e2%80%a4"],
  ["‥", "%e2%80%a5"],
  ["…", "%e2%80%a6"],
  ["。", "%e3%80%82"],
  ["︙", "%ef%b8%99"],
  ["︰", "%ef%b8%b0"],
  ["﹒", "%ef%b9%92"],
  ["．", "%ef%bc%8e"],
  ["｡", "%ef%bd%a1"],
];

const ITEM_1_REFUSED = [
  "/Items/..;/x",
  "/Items/%2e%2e;/x",
  "/Items/..%3b/x",
  "/Items/..%253b/x",
  "/Items/a;b",
  "/Items/a;v=1/x",
  "/Items/..%00/x",
  "/Items/a%00b",
  "/Items/a%2500b",
  "/Items/a%0ab",
  "/Items/a%7fb",
  "/Items/a%c2%85b",
  "/Items/a\u0085b",
  "/Items/a\u009fb",
];
const ITEM_1_ACCEPTED = ["/Items/a%3Ab"];

const ITEM_2_REFUSED = [...new Set([
  "/Items/%ef%bc%8e%ef%bc%8e/x",
  "/Items/%EF%BC%8E/x",
  "/Items/.%ef%bc%8e/x",
  "/Items/%ef%bc%8e%ef%bc%8e%ef%bc%8e/x",
  "/Items/%25ef%25bc%258e%25ef%25bc%258e/x",
  "/Items/%e2%80%a4%e2%80%a4/x",
  "/Items/%e2%80%a5/x",
  "/Items/%e2%80%a6/x",
  "/Items/%e3%80%82%e3%80%82/x",
  "/Items/%ef%b8%99/x",
  "/Items/%ef%b8%b0/x",
  "/Items/%ef%b9%92%ef%b9%92/x",
  "/Items/%ef%bd%a1%ef%bd%a1/x",
  "/Items/．．/x",
  // One case per listed character: escaped once, escaped twice, and as written.
  ...DOT_LIKE.map(([, escape]) => `/Items/${escape}/x`),
  ...DOT_LIKE.map(([, escape]) => `/Items/${escape.replaceAll("%", "%25")}/x`),
  ...DOT_LIKE.map(([raw]) => `/Items/${raw}/x`),
])];
const ITEM_2_ACCEPTED = ["/Items/%EF%BC%8Ea", "/Items/a%E2%80%A6", "/Items/..."];

const ITEM_3_REFUSED = [
  "/Items/%25c0%25ae%25c0%25ae/x",
  "/Items/%2525c0%2525ae/x",
  "/Items/%25ed%25a0%2580",
  "/Items/%252525252e%252525252e/x",
  "/Items/%2525252541",
];
const ITEM_3_ACCEPTED = ["/Items/%25252541", "/Items/100%25"];

describe("isSafeRequestPath after T3-24", () => {
  it.each(ITEM_1_REFUSED)("T3-24 item 1: refuses %j", (path) => {
    expect(isSafeRequestPath(path)).toBe(false);
  });

  it.each(ITEM_1_ACCEPTED)("T3-24 item 1: accepts the near miss %j", (path) => {
    expect(isSafeRequestPath(path)).toBe(true);
  });

  it.each(ITEM_2_REFUSED)("T3-24 item 2: refuses %j", (path) => {
    expect(isSafeRequestPath(path)).toBe(false);
  });

  it.each(ITEM_2_ACCEPTED)("T3-24 item 2: accepts the near miss %j", (path) => {
    expect(isSafeRequestPath(path)).toBe(true);
  });

  it.each(ITEM_3_REFUSED)("T3-24 item 3: refuses %j", (path) => {
    expect(isSafeRequestPath(path)).toBe(false);
  });

  it.each(ITEM_3_ACCEPTED)("T3-24 item 3: accepts the near miss %j", (path) => {
    expect(isSafeRequestPath(path)).toBe(true);
  });
});

// "The vectors" of docs/specs/T3-24.md, as the fixture must hold them.
const SPEC_REFUSED = [
  "/Items/..;/x",
  "/Items/%2e%2e;/x",
  "/Items/..%3b/x",
  "/Items/..%253b/x",
  "/Items/a;b",
  "/Items/a;v=1/x",
  "/Items/..%00/x",
  "/Items/a%00b",
  "/Items/a%2500b",
  "/Items/a%0ab",
  "/Items/a%7fb",
  "/Items/a%c2%85b",
  "/Items/%ef%bc%8e%ef%bc%8e/x",
  "/Items/%EF%BC%8E/x",
  "/Items/.%ef%bc%8e/x",
  "/Items/%ef%bc%8e%ef%bc%8e%ef%bc%8e/x",
  "/Items/%25ef%25bc%258e%25ef%25bc%258e/x",
  "/Items/%e2%80%a4%e2%80%a4/x",
  "/Items/%e2%80%a5/x",
  "/Items/%e2%80%a6/x",
  "/Items/%e3%80%82%e3%80%82/x",
  "/Items/%ef%b8%99/x",
  "/Items/%ef%b8%b0/x",
  "/Items/%ef%b9%92%ef%b9%92/x",
  "/Items/%ef%bd%a1%ef%bd%a1/x",
  "/Items/．．/x",
  "/Items/%25c0%25ae%25c0%25ae/x",
  "/Items/%2525c0%2525ae/x",
  "/Items/%25ed%25a0%2580",
  "/Items/%252525252e%252525252e/x",
  "/Items/%2525252541",
];
const SPEC_ACCEPTED = ["/Items/%25252541", "/Items/100%25", "/Items/%EF%BC%8Ea", "/Items/a%E2%80%A6", "/Items/item%2Fwith%20slash/Similar"];

// The paths the acceptance text names.
const NAMED_REFUSED = [
  "/Items/..;/x",
  "/Items/%2e%2e;/x",
  "/Items/..%00/x",
  "/Items/%ef%bc%8e%ef%bc%8e/x",
  "/Items/%25c0%25ae%25c0%25ae/x",
  "/Items/%252525252e%252525252e/x",
];

describe("request-paths.json after T3-24", () => {
  const refused = vectors.refused.map((vector) => vector.path);
  const accepted = vectors.accepted.map((vector) => vector.path);

  it("T3-24 item 5: the fixture holds every refuse vector of the spec", () => {
    expect(SPEC_REFUSED.filter((path) => !refused.includes(path))).toEqual([]);
  });

  it("T3-24 item 5: the fixture holds every accept vector of the spec", () => {
    expect(SPEC_ACCEPTED.filter((path) => !accepted.includes(path))).toEqual([]);
  });

  it("T3-24 item 5: each path the acceptance text names is a refuse vector", () => {
    expect(NAMED_REFUSED.filter((path) => !refused.includes(path))).toEqual([]);
  });

  it("T3-24 item 5: no path is both a refuse and an accept vector", () => {
    expect(refused.filter((path) => accepted.includes(path))).toEqual([]);
  });

  it.each(vectors.refused.map((vector) => [vector.name, vector.path]))("T3-24 item 5: refuses the vector %s", (_name, path) => {
    expect(isSafeRequestPath(path)).toBe(false);
  });

  it.each(vectors.accepted.map((vector) => [vector.name, vector.path]))("T3-24 item 5: accepts the vector %s", (_name, path) => {
    expect(isSafeRequestPath(path)).toBe(true);
  });

  it.each([...new Set([...ITEM_1_REFUSED, ...ITEM_2_REFUSED, ...ITEM_3_REFUSED])])("T3-24 item 5: refuses the item 1 to 3 path %j", (path) => {
    expect(isSafeRequestPath(path)).toBe(false);
  });

  it.each([...ITEM_1_ACCEPTED, ...ITEM_2_ACCEPTED, ...ITEM_3_ACCEPTED])("T3-24 item 5: accepts the item 1 to 3 near miss %j", (path) => {
    expect(isSafeRequestPath(path)).toBe(true);
  });
});
