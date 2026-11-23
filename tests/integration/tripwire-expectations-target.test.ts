import { describe, expect, it } from "vitest";
import { expectationFor, JELLYSCALE_FORCED_CONVERSION, runPlan } from "./tripwire-expectations";

// T8-23 item 6: the tripwire expectations take the changed result. A set that lacks h264 cannot decode the H.264 every
// server encodes into, so its lacking row is the typed refusal on all three servers; the other lacking sets still
// convert on Jellyfin. Docker-free: it reads the expectation table only.
const JELLYFIN = ["jellyfin-10-11", "jellyfin-12"] as const;
const REFUSED = { kind: "refused", reason: "device-cannot-play" };
const CONVERSION = { kind: "conversion", methods: ["Transcode"], clientReason: "DeviceCannotPlay" };

describe("T8-23 item 6: the no-h264 set is refused on every server", () => {
  it("the lacking h264 sample is the device-cannot-play refusal on both Jellyfin servers", () => {
    for (const server of JELLYFIN) expect(expectationFor(server, "no-h264", "h264"), server).toEqual(REFUSED);
  });

  it("the Jellyfin rows are their own value, not the Jellyscale constant that T10-08 changes", () => {
    for (const server of JELLYFIN) expect(expectationFor(server, "no-h264", "h264"), server).not.toBe(JELLYSCALE_FORCED_CONVERSION);
  });

  it("the Jellyscale row stays the refusal", () => {
    expect(expectationFor("jellyscale", "no-h264", "h264")).toEqual(REFUSED);
  });

  it("the control sample under no-h264 still direct plays on every server", () => {
    for (const server of [...JELLYFIN, "jellyscale"]) expect(expectationFor(server, "no-h264", "hevc-hdr10").kind, server).toBe("direct-play");
  });
});

describe("T8-23 item 6: the other lacking sets still convert on Jellyfin", () => {
  it.each([
    ["no-hevc", "hevc-hdr10"],
    ["no-av1", "av1"],
  ] as const)("%s: the lacking sample is a Transcode with DeviceCannotPlay on both Jellyfin servers", (set, sample) => {
    for (const server of JELLYFIN) expect(expectationFor(server, set, sample), server).toEqual(CONVERSION);
  });
});

describe("T8-23 item 6: the run plan carries the changed rows", () => {
  it("every no-h264 lacking row in the plan is the refusal", () => {
    const rows = runPlan(true).filter((row) => row.set === "no-h264" && row.sample === "h264");
    expect(rows.map((row) => row.server).sort()).toEqual(["jellyfin-10-11", "jellyfin-12", "jellyscale"]);
    for (const row of rows) expect(row.expect, row.server).toEqual(REFUSED);
  });
});
