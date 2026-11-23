import { describe, expect, it } from "vitest";
import vectors from "../../tests/fixtures/device-capability-probes.json";
import { readCapabilities } from "./player-capabilities";
import type { PlayerCapabilities } from "./player-engine";

// T8-23 item 4: the reader copies the three limits a device may report (spec "The source decision reads more"). A
// bad limit narrows the list and never widens it: the decoder or the audio codec is dropped.
type Complete = Extract<PlayerCapabilities, { probe: "complete" }>;

function answer(videoDecoders: unknown[], audioDecoders: unknown[] = ["aac"], extra: Record<string, unknown> = {}) {
  return { probe: "complete", videoDecoders, audioDecoders, hdr: [], passthrough: [], ...extra };
}

function read(raw: unknown): Complete {
  const result = readCapabilities(raw);
  if (result.probe !== "complete") throw new Error("expected a complete answer");
  return result;
}

describe("T8-23 item 4: readCapabilities copies valid limits", () => {
  it("copies maxLevel and maxFrameRate on a video decoder", () => {
    const caps = read(answer([
      { codec: "h264", hardware: true, profile: "High", maxLevel: 41, maxFrameRate: 60 },
      { codec: "hevc", hardware: true, maxLevel: 153, maxFrameRate: 23.976 },
      { codec: "av1", hardware: false, maxLevel: 8 },
    ]));
    expect(caps.videoDecoders).toEqual([
      { codec: "h264", hardware: true, profile: "High", maxLevel: 41, maxFrameRate: 60 },
      { codec: "hevc", hardware: true, maxLevel: 153, maxFrameRate: 23.976 },
      { codec: "av1", hardware: false, maxLevel: 8 },
    ]);
  });

  it("copies maxAudioChannels per audio codec", () => {
    const caps = read(answer([{ codec: "h264", hardware: true }], ["aac", "ac3"], { maxAudioChannels: { aac: 2, ac3: 6 } }));
    expect(caps.audioDecoders).toEqual(["aac", "ac3"]);
    expect((caps as Complete & { maxAudioChannels?: unknown }).maxAudioChannels).toEqual({ aac: 2, ac3: 6 });
  });

  it("keeps two decoders that differ only in a limit", () => {
    const caps = read(answer([
      { codec: "h264", hardware: true, maxLevel: 41 },
      { codec: "h264", hardware: true, maxLevel: 51 },
      { codec: "h264", hardware: true, maxFrameRate: 30 },
      { codec: "h264", hardware: true, maxFrameRate: 60 },
    ]));
    expect(caps.videoDecoders).toHaveLength(4);
  });
});

describe("T8-23 item 4: readCapabilities drops what a bad limit would widen", () => {
  it.each([
    ["a negative level", { maxLevel: -1 }],
    ["a level given as text", { maxLevel: "41" }],
    ["a level that is not a number", { maxLevel: Number.NaN }],
    ["a negative frame rate", { maxFrameRate: -24 }],
    ["a frame rate given as text", { maxFrameRate: "60" }],
    ["an infinite frame rate", { maxFrameRate: Number.POSITIVE_INFINITY }],
  ] as const)("drops a decoder with %s, and keeps the others", (_name, limit) => {
    const caps = read(answer([{ codec: "h264", hardware: true, ...limit }, { codec: "hevc", hardware: true }]));
    expect(caps.videoDecoders).toEqual([{ codec: "hevc", hardware: true }]);
  });

  it.each(["vp9", "vp8", "mpeg2video", "mpeg4", "vc1"] as const)("drops a %s decoder that states a level (no scale is known for it)", (codec) => {
    const caps = read(answer([{ codec, hardware: true, maxLevel: 41 }, { codec: "h264", hardware: true, maxLevel: 41 }]));
    expect(caps.videoDecoders).toEqual([{ codec: "h264", hardware: true, maxLevel: 41 }]);
  });

  it.each([
    ["a negative count", -2],
    ["a count given as text", "2"],
    ["a count that is not a number", Number.NaN],
  ] as const)("drops an audio codec whose channel limit is %s, and keeps the others", (_name, limit) => {
    const caps = read(answer([{ codec: "h264", hardware: true }], ["aac", "ac3"], { maxAudioChannels: { aac: limit, ac3: 6 } }));
    expect(caps.audioDecoders).toEqual(["ac3"]);
  });
});

describe("T8-23 item 4: answers without the limits read as before", () => {
  it("reads every frozen T8-07 vector back equal", () => {
    for (const vector of (vectors as { cases: { name: string; capabilities: unknown }[] }).cases) {
      expect(readCapabilities(vector.capabilities), vector.name).toEqual(vector.capabilities);
    }
  });

  it("adds no limit the answer did not state", () => {
    const caps = read(answer([{ codec: "h264", hardware: true, profile: "High", maxWidth: 1920, maxHeight: 1080 }], ["aac"]));
    expect(caps.videoDecoders).toEqual([{ codec: "h264", hardware: true, profile: "High", maxWidth: 1920, maxHeight: 1080 }]);
  });
});
