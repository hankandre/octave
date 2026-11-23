import { describe, expect, it } from "vitest";
import { ANDROID_APPLICATION_ID, APP_NAME } from "./app-identity";

describe("app identity", () => {
  it("T3-21 item 7: names the product Octave", () => {
    expect(APP_NAME).toBe("Octave");
  });

  it("T3-21 item 7: uses the owner's Android application ID, in a form Android accepts", () => {
    expect(ANDROID_APPLICATION_ID).toBe("cloud.jellyscale.octave");
    // Two or more segments, each starting with a letter (Android's applicationId rules).
    expect(ANDROID_APPLICATION_ID).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/);
  });
});
