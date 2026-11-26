// T4-04 item 3 (docs/specs/T4-04.md, D4): which failure each answer to a password sign-in is.
//
// Testing contract (the implementer builds to it)
// - `passwordSignInFailure(error)` (./password-sign-in) answers "wrong-credentials", "refused", "unreachable",
//   "redirect" or "other", and undefined for a cancellation. It reads `name`, `kind`, `code` and `status`, never `message`.
import { describe, expect, it } from "vitest";
import { TransportError } from "../ports/transport";
import { SignInFailure } from "./sign-in-failure";
import { passwordSignInFailure } from "./password-sign-in";

const WRONG_NAME_OR_PASSWORD = "That username and password didn't work.";

const cancelledByName = () => Object.assign(new Error("aborted"), { name: "AbortError" });

describe("T4-04 item 3: which failure a password sign-in answer is", () => {
  it.each([
    ["a 401", new TransportError("status", 401), "wrong-credentials"],
    ["a 403", new TransportError("status", 403), "refused"],
    ["a network failure", new TransportError("network"), "unreachable"],
    ["a timeout", new TransportError("timeout"), "unreachable"],
    ["the gateway's redirect failure", new SignInFailure("redirect", "redirected"), "redirect"],
    ["a transport redirect", new TransportError("redirect"), "redirect"],
  ] as const)("T4-04 item 3: %s is %s", (_name, error, expected) => {
    expect(passwordSignInFailure(error)).toBe(expected);
  });

  it.each([
    ["a cancelled request", new TransportError("cancelled")],
    ["an AbortError", cancelledByName()],
  ])("T4-04 item 3: %s is no failure", (_name, error) => {
    expect(passwordSignInFailure(error)).toBeUndefined();
  });

  it.each([
    ["a 400", new TransportError("status", 400)],
    ["a 404", new TransportError("status", 404)],
    ["a 429", new TransportError("status", 429)],
    ["a 500", new TransportError("status", 500)],
    ["an unusable answer", new TransportError("unexpected-response")],
    ["a request refused before it was sent", new TransportError("refused")],
    ["an unconfirmed server", new SignInFailure("not-confirmed", "not confirmed")],
    ["the gateway's unusable session", new SignInFailure("unexpected-response", "no session")],
    ["a plain error", new Error("boom")],
    ["a thrown string", "boom"],
    ["nothing", undefined],
    ["null", null],
  ])("T4-04 item 3: %s is anything else", (_name, error) => {
    expect(passwordSignInFailure(error)).toBe("other");
  });

  it("T4-04 item 3: the message is ignored, so only the status decides", () => {
    const misleading = Object.assign(new TransportError("status", 500), { message: WRONG_NAME_OR_PASSWORD });
    const unhelpful = Object.assign(new TransportError("status", 401), { message: "Something went wrong. Try again." });

    expect(passwordSignInFailure(misleading)).toBe("other");
    expect(passwordSignInFailure(unhelpful)).toBe("wrong-credentials");
  });
});
