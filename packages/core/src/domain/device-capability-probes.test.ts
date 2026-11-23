import { describe, expect, it } from "vitest";
import vectors from "../../tests/fixtures/device-capability-probes.json";
import { devicePlayability, type SourceFormat } from "./device-capabilities";
import { readCapabilities } from "./player-capabilities";
import type { PlayerCapabilities } from "./player-engine";

// T8-07 item 8, TypeScript half (docs/specs/T8-07.md, Test plan 1 and 5; D4, D5, D6): the shared vectors the
// Kotlin CapabilityMapTest also reads. For every case, the answer the probe gives crosses the app's reader unchanged
// (the probe never emits a profile the reader would widen), and the core's source decision answers each listed source
// as the case says: an 8-bit HEVC Main and an H.264 Main source play on a device that decodes them, a source that
// states no profile converts when every decoder for its codec states one and plays when one states none.
type Case = {
  name: string;
  platform: { video: { codec: string; hardware: boolean; profiles: { name: string; bitDepth?: number }[]; maxWidth?: number; maxHeight?: number }[] };
  capabilities: PlayerCapabilities;
  plays: { source: SourceFormat; video: boolean }[];
};

const PROFILE = /^[A-Za-z0-9 .+-]{1,32}$/;
const cases = vectors.cases as unknown as Case[];

const named = (fragment: string) => {
  const found = cases.find((entry) => entry.name.includes(fragment));
  if (!found) throw new Error(`no vector case naming ${fragment}`);
  return found;
};

describe("T8-07 item 8: the shared capability vectors", () => {
  it("T8-07 item 8: hold the cases the spec's test plan names", () => {
    for (const fragment of [
      "reporting only High lists",
      "reporting only Main 10",
      "AV1 Main10",
      "VP9",
      "VP8",
      "empty profile list",
      "High 4:2:2",
      "unknown codec",
      "emulator-like",
      "no video decoder",
    ]) {
      expect(() => named(fragment), fragment).not.toThrow();
    }
  });

  it.each(cases.map((entry) => [entry.name, entry] as const))("T8-07 item 8: %s crosses readCapabilities unchanged", (_name, entry) => {
    expect(readCapabilities(entry.capabilities)).toEqual(entry.capabilities);
  });

  it.each(cases.map((entry) => [entry.name, entry] as const))("T8-07 item 8: %s states only profiles the reader keeps", (_name, entry) => {
    if (entry.capabilities.probe !== "complete") return;
    for (const decoder of entry.capabilities.videoDecoders) {
      if (decoder.profile !== undefined) expect(decoder.profile, `${decoder.codec} ${decoder.profile}`).toMatch(PROFILE);
    }
  });

  it.each(cases.map((entry) => [entry.name, entry] as const))("T8-07 item 8: %s gives the source decision the case's answers", (_name, entry) => {
    expect(entry.plays.length).toBeGreaterThan(0);
    for (const { source, video } of entry.plays) {
      expect(devicePlayability(source, entry.capabilities).video, JSON.stringify(source)).toBe(video);
    }
  });

  it("T8-07 item 8: an 8-bit HEVC Main source and an H.264 Main source play on a device that decodes them", () => {
    const hevc = named("reporting only Main 10");
    expect(devicePlayability({ video: { codec: "hevc", profile: "Main", bitDepth: 8, width: 1920, height: 1080 } }, hevc.capabilities).video).toBe(true);
    const avc = named("reporting only High lists");
    expect(devicePlayability({ video: { codec: "h264", profile: "Main", bitDepth: 8, width: 1920, height: 1080 } }, avc.capabilities).video).toBe(true);
  });

  it("T8-07 item 8: a source that states no profile converts when every decoder for its codec states one, and plays when one states none", () => {
    const avc = named("reporting only High lists");
    expect(devicePlayability({ video: { codec: "h264", bitDepth: 8, width: 1920, height: 1080 } }, avc.capabilities).video).toBe(false);
    const vp8 = named("VP8");
    expect(devicePlayability({ video: { codec: "vp8", bitDepth: 8, width: 1280, height: 720 } }, vp8.capabilities).video).toBe(true);
  });

  it("T8-07 item 8: a report with no video decoder is cannot tell, and nothing plays", () => {
    const none = named("no video decoder");
    expect(none.platform.video).toEqual([]);
    expect(none.capabilities).toEqual({ probe: "failed" });
  });
});
