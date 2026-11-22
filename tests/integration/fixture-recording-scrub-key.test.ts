import { describe, expect, it } from "vitest";
import { makeScrubber } from "./fixture-recording.mjs";

// T5-02 review: a dashed id followed by more hex (a UserData.Key) must not survive the scrubber.
describe("makeScrubber with an id followed by more digits", () => {
  const scrub = makeScrubber({
    tokens: [],
    host: "host.invalid:8096",
    fakeUserIds: [],
    fakeServerId: { real: "0".repeat(32), fake: "server-1" },
    knownIds: new Map(),
    serverNames: [],
  });

  it("replaces the id and keeps no dashed id in the text", () => {
    const out = JSON.stringify(scrub({ Key: "74098ae7-4da9-10f4-c132-c1d51e73afb1000001" }));
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(out).toContain("id-1");
  });

  it("still gives a plain id the same fake as the same id with a suffix", () => {
    const out = scrub({ a: "74098ae7-4da9-10f4-c132-c1d51e73afb1", b: "74098ae7-4da9-10f4-c132-c1d51e73afb1000001" }) as { a: string; b: string };
    expect(out.b.startsWith(out.a)).toBe(true);
  });
});
