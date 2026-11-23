// @vitest-environment node
// T8-02 item 6: the runner's reading of the emulator's decoder list (scripts/tv-wire-decoders.mjs). Not frozen; the
// excerpts follow `dumpsys media.player` on the android-tv API 36 x86_64 emulator image (2026-11-23).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type Decoders = { hevc: { type: boolean; profile: boolean }; av1: { type: boolean; profile: boolean } } | null;
const { readDecoderList } = (await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "tv-wire-decoders.mjs")).href)) as {
  readDecoderList: (output: unknown) => Decoders;
};

const entry = (type: string, name: string, profiles: string[]) =>
  [`Media type '${type}':`, `  Decoder "${name}" supports`, "    profile/levels: [", ...profiles.map((p, i) => `          ${i + 1}/32768 (${p}/5.2)${i === profiles.length - 1 ? " ]" : ","}`), "    colors: [ ]"].join("\n");

const dump = (...entries: string[]) => ["", "Decoder infos by media types:", "=============================", ...entries, "Encoder infos by media types:", entry("video/hevc", "c2.android.hevc.encoder", ["Main10"])].join("\n");

describe("T8-02 item 6: the emulator's decoder list", () => {
  it("reads HEVC Main only as the type without the profile, and AV1 Main10 as both", () => {
    const output = dump(entry("video/hevc", "c2.android.hevc.decoder", ["Main", "MainStill"]), entry("video/av01", "c2.android.av1.decoder", ["Main8", "Main10"]));
    expect(readDecoderList(output)).toEqual({ hevc: { type: true, profile: false }, av1: { type: true, profile: true } });
  });

  it("reads no decoder for a type the section does not list, and ignores encoders", () => {
    expect(readDecoderList(dump(entry("video/avc", "c2.android.avc.decoder", ["High"])))).toEqual({ hevc: { type: false, profile: false }, av1: { type: false, profile: false } });
  });

  it("reads a profile list that spans lines", () => {
    const output = dump(entry("video/hevc", "c2.vendor.hevc.decoder", ["Main", "Main10", "Main10HDR10"]));
    expect(readDecoderList(output)?.hevc).toEqual({ type: true, profile: true });
  });

  it("answers null for output with no decoder section, empty output, or none", () => {
    expect(readDecoderList("Can't find service: media.player")).toBeNull();
    expect(readDecoderList("")).toBeNull();
    expect(readDecoderList(undefined)).toBeNull();
    expect(readDecoderList("Decoder infos by media types:\n=====\nEncoder infos by media types:")).toBeNull();
  });
});
