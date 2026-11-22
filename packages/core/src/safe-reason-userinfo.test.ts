import { describe, expect, it } from "vitest";
import { safeReason } from "./safe-reason";

describe("T9-07 review fixes: user info", () => {
  it("hides the password when the user name is an email", () => {
    const out = safeReason("connect me@mail.com:secret@nas failed");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("mail.com");
  });

  it.each([
    "user:Zm9v+/YmFy@192.168.1.10:8096",
    "user:pa-/ss@nas",
    "user:pass:/x@nas",
    "user:a~/b@nas",
  ])("hides a password that holds a path start: %s", (input) => {
    const out = safeReason(`connect ${input} failed`);
    expect(out).toBe("connect [address] failed");
  });
});
