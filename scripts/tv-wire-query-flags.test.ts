// @vitest-environment node
// T8-07 item 7: the wire judge reads a PlaybackInfo query flag the way the server binds it, so a second spelling of the
// same flag in another case or percent-encoded counts as a duplicate, never as an absent parameter.
import { describe, expect, it } from "vitest";
import { playbackInfoFacts } from "./tv-wire-proxy.mjs";

const facts = (search: string) => playbackInfoFacts("{}", `/Items/x/PlaybackInfo?${search}`).query;

describe("T8-07 item 7: query flag names are matched as the server binds them", () => {
  it("reads a flag whose name is written in another case", () => {
    expect(facts("enabledirectplay=false").EnableDirectPlay).toBe(false);
    expect(facts("ENABLEDIRECTSTREAM=true").EnableDirectStream).toBe(true);
  });

  it("reads a flag whose name is percent-encoded", () => {
    expect(facts("Enable%44irectPlay=false").EnableDirectPlay).toBe(false);
  });

  it("is null when the flag is sent twice under spellings that differ only in case", () => {
    expect(facts("EnableDirectPlay=false&enabledirectplay=true").EnableDirectPlay).toBeNull();
    expect(facts("EnableDirectPlay=false&Enable%44irectPlay=false").EnableDirectPlay).toBeNull();
  });

  it("ignores a name that does not decode", () => {
    expect(facts("EnableDirectPlay=false&Enable%ZZDirectPlay=true").EnableDirectPlay).toBe(false);
  });
});
