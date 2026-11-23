import { describe, expect, it } from "vitest";
import vectors from "../../tests/fixtures/device-capability-probes.json";
import type { PlayerCapabilities } from "../domain/player-engine";
import { OCTAVE_PROFILE } from "./device-profile";
import { FAILED, negotiate, recorded, VERSIONS } from "./device-test-support";

// T8-07 item 4 (docs/specs/T8-07.md, Test plan 6): the DeviceProfile sent to the server is the same on every device.
// Whatever the device probe answers ("full", cannot tell, an empty list, or any of the shared vectors' real probe
// outputs), every PlaybackInfo body carries OCTAVE_PROFILE with that request's MaxStreamingBitrate, and nothing else.
// The wire half (the profile digest on every recorded PlaybackInfo) is in scripts/tv-wire-capabilities.test.ts.
const EMPTY: PlayerCapabilities = { probe: "complete", videoDecoders: [], audioDecoders: [], hdr: [], passthrough: [] };

const DEVICES: [string, PlayerCapabilities | "full"][] = [
  ["full", "full"],
  ["a failed probe", FAILED],
  ["an empty complete list", EMPTY],
  ...(vectors.cases as unknown as { name: string; capabilities: PlayerCapabilities }[]).map(
    (entry) => [`the vector "${entry.name}"`, entry.capabilities] as [string, PlayerCapabilities],
  ),
];

describe.each(VERSIONS)("T8-07 item 4: the DeviceProfile on every PlaybackInfo to Jellyfin %s", (version) => {
  it.each(DEVICES)("T8-07 item 4: is OCTAVE_PROFILE for %s", async (_name, capabilities) => {
    const { transport } = await negotiate("item-h264", [recorded(version, "conversion-h264"), recorded(version, "device-conversion-h264")], capabilities);
    expect(transport.posts.length).toBeGreaterThan(0);
    for (const post of transport.posts) {
      expect(post.data.DeviceProfile).toEqual({ ...OCTAVE_PROFILE, MaxStreamingBitrate: post.data.MaxStreamingBitrate });
    }
  });

  it("T8-07 item 4: is byte-for-byte the same body field whether the device plays the source or not", async () => {
    const profiles: string[] = [];
    for (const [, capabilities] of DEVICES) {
      const { transport } = await negotiate("item-h264", [recorded(version, "conversion-h264"), recorded(version, "device-conversion-h264")], capabilities);
      for (const post of transport.posts) profiles.push(JSON.stringify(post.data.DeviceProfile));
    }
    expect(new Set(profiles).size).toBe(1);
  });
});
