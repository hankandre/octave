// T4-04 item 5 (docs/specs/T4-04.md, D6): the one value both password routes are drawn from.
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGN_IN_METHODS } from "./sign-in-methods";

describe("T4-04 item 5: the sign-in methods value", () => {
  it("T4-04 item 5: password sign-in is offered by default", () => {
    expect(DEFAULT_SIGN_IN_METHODS).toEqual({ password: "offered" });
  });
});
