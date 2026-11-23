// The device's decoder list for pnpm tv:wire's player-samples judge (T8-02 item 6; docs/specs/T8-02.md, "The device's
// decoder list"): read once per run, read-only, from `adb shell dumpsys media.player`, whose "Decoder infos by media
// types" section lists each decoder per media type with its profile/levels, as Android's MediaCodecList reports them.
// A sample's type is taken when a decoder is listed for its media type, its profile when a listed decoder names the
// sample's profile: Main10 for the 10-bit HEVC HDR10 and AV1 samples. Output that holds no decoder section is unread
// (null), and the judge fails the pair on it; it never passes it.
const SAMPLES = {
  hevc: { type: "video/hevc", profile: "Main10" },
  av1: { type: "video/av01", profile: "Main10" },
};

/** `dumpsys media.player` output -> { hevc: { type, profile }, av1: { type, profile } }, or null when unreadable. */
export function readDecoderList(output) {
  if (typeof output !== "string") return null;
  const start = output.indexOf("Decoder infos by media types:");
  if (start < 0) return null;
  const end = output.indexOf("Encoder infos by media types:", start);
  const section = output.slice(start, end < 0 ? undefined : end);
  const byType = new Map();
  let type = null;
  let inProfiles = false;
  for (const line of section.split("\n")) {
    const media = /^Media type '([^']+)':/.exec(line.trim());
    if (media) {
      type = media[1];
      if (!byType.has(type)) byType.set(type, { decoders: 0, profiles: new Set() });
      inProfiles = false;
      continue;
    }
    if (type === null) continue;
    if (/^Decoder "[^"]+" supports/.test(line.trim())) byType.get(type).decoders += 1;
    if (/^profile\/levels: \[/.test(line.trim())) inProfiles = true;
    if (inProfiles) {
      for (const match of line.matchAll(/\(([A-Za-z0-9]+)\//g)) byType.get(type).profiles.add(match[1]);
      if (line.includes("]")) inProfiles = false;
    }
  }
  if (byType.size === 0) return null;
  return Object.fromEntries(
    Object.entries(SAMPLES).map(([key, sample]) => {
      const listed = byType.get(sample.type);
      const taken = listed !== undefined && listed.decoders > 0;
      return [key, { type: taken, profile: taken && listed.profiles.has(sample.profile) }];
    }),
  );
}
