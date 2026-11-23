import { describe, expect, it } from "vitest";
import { readCapabilities } from "./player-capabilities";
import type { PlayerCapabilities } from "./player-engine";

// T8-23 item 4: the limit shapes the frozen tests leave open. A null limit is absent (a bridge writes null for a value
// it did not read); a channel-limit map that is not a map narrows the audio list to nothing.
type Complete = Extract<PlayerCapabilities, { probe: "complete" }>;

function read(raw: unknown): Complete {
  const result = readCapabilities(raw);
  if (result.probe !== "complete") throw new Error("expected a complete answer");
  return result;
}

const base = { probe: "complete", hdr: [], passthrough: [] };

describe("T8-23 item 4: readCapabilities reads limit shapes", () => {
  it("reads a null level or frame rate as no limit", () => {
    const caps = read({ ...base, videoDecoders: [{ codec: "h264", hardware: true, maxLevel: null, maxFrameRate: null }], audioDecoders: ["aac"] });
    expect(caps.videoDecoders).toEqual([{ codec: "h264", hardware: true }]);
  });

  it("reads a null channel-limit map as no limit", () => {
    const caps = read({ ...base, videoDecoders: [], audioDecoders: ["aac"], maxAudioChannels: null });
    expect(caps.audioDecoders).toEqual(["aac"]);
    expect(caps).not.toHaveProperty("maxAudioChannels");
  });

  it("drops every audio decoder when the channel-limit map is not a map", () => {
    for (const bad of [2, "2", [2]]) {
      const caps = read({ ...base, videoDecoders: [], audioDecoders: ["aac", "ac3"], maxAudioChannels: bad });
      expect(caps.audioDecoders, JSON.stringify(bad)).toEqual([]);
    }
  });

  it("keeps an av1 level of 0 (seq_level_idx of level 2.0) and ignores a limit for a codec the list does not hold", () => {
    const caps = read({ ...base, videoDecoders: [{ codec: "av1", hardware: true, maxLevel: 0 }], audioDecoders: ["aac"], maxAudioChannels: { aac: 2, opus: 2 } });
    expect(caps.videoDecoders).toEqual([{ codec: "av1", hardware: true, maxLevel: 0 }]);
    expect(caps.maxAudioChannels).toEqual({ aac: 2 });
  });
});
