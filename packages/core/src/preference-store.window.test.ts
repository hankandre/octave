import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, sanitizeContinueWindow } from "./preference-store";

// T5-07 item 2: the store validates the window against the domain's list and defaults to 90 days (D2).
describe("the stored Continue watching window", () => {
  it.each(["30", "90", "180", "365", "all"])("T5-07 item 2: accepts %s", (value) => {
    expect(sanitizeContinueWindow(value)).toBe(value);
  });

  it.each(["7", "14"])("T5-07 item 2: maps the old value %s to 90", (value) => {
    expect(sanitizeContinueWindow(value)).toBe("90");
  });

  it.each([undefined, null, "", 90, "forever"])("T5-07 item 2: maps %j to 90", (value) => {
    expect(sanitizeContinueWindow(value)).toBe("90");
  });

  it("T5-07 item 2: defaults to 90", () => {
    expect(DEFAULT_PREFERENCES.continueWindow).toBe("90");
  });
});
