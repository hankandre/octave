// @vitest-environment node
import { describe, expect, it } from "vitest";
import vectors from "../../tests/fixtures/request-paths.json";
import { isSafeRequestPath } from "./request-path";

describe("isSafeRequestPath", () => {
  it.each(vectors.refused.map((vector) => [vector.name, vector.path]))("refuses %s", (_name, path) => {
    expect(isSafeRequestPath(path)).toBe(false);
  });

  it.each(vectors.accepted.map((vector) => [vector.name, vector.path]))("accepts %s", (_name, path) => {
    expect(isSafeRequestPath(path)).toBe(true);
  });

  // The decisions beyond the shared vectors, held the same way by RequestPathRuleTest.kt.
  it.each([
    ["an encoded surrogate", "/Items/%ed%a0%80"],
    ["a code point above U+10FFFF", "/Items/%f4%90%80%80"],
    ["a lone continuation byte", "/Items/%80"],
    ["a delete character", "/Items/a\u007fb"],
    ["four rounds of encoding around a dot-dot", "/Items/%2525252e%2525252e/x"],
  ])("refuses %s", (_name, path) => {
    expect(isSafeRequestPath(path)).toBe(false);
  });

  it.each([
    ["a percent sign written as %25", "/Items/100%25"],
    ["a three-byte character", "/Items/%e2%82%ac"],
    ["an empty segment", "/Items//x"],
    ["a trailing slash", "/Items/"],
  ])("accepts %s", (_name, path) => {
    expect(isSafeRequestPath(path)).toBe(true);
  });
});
