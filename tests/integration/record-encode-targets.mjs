// Records which codec each server encodes into (T8-23 milestone 1, acceptance 3) and the forced answers for the two
// disc kinds (T8-23 items 1 and 2).
// Usage: OCTAVE_CONVERSION_SAMPLES=1 pnpm samples:generate && pnpm fixture:up && pnpm fixture:setup &&
//        node tests/integration/record-encode-targets.mjs
//
// Writes, per Jellyfin version folder:
//   encode-target-hevc-hdr10.json, encode-target-av1.json   the forced conversion (direct play and video copy off)
//   encode-target-no-decoder.json                            a first answer under a streaming limit, for a source
//                                                            whose video codec is outside the URL's list
//   device-disc-conversion-iso.json,
//   device-disc-conversion-bluray-folder.json                the answer to the forced conversion after a disc's
//                                                            fallback, with both copies off (a PlaybackInfo answer)
// and, into the Jellyscale pin folder:
//   encode-target-h264-limited.json, encode-target-hevc-hdr10.json, encode-target-av1.json,
//   encode-target-no-decoder.json                            a first answer under a streaming limit
//   encode-target-h264-limited-forced.json                   the forced request for the limited H.264 film
//
// An encode-target file holds the request's flags, the scrubbed PlaybackInfo answer, the CODECS attribute of every
// variant of the master playlist (fetched with the header, never with a credential in the URL), and the session's
// TranscodingInfo when the server reported one after the first segment was asked for (null when it did not). The
// job is stopped with DELETE /Videos/ActiveEncodings either way. An answer with no TranscodingUrl is written with
// "recorded": false. The request is the one the gateway sends: the decision 0002 profile, the flags in body and query.
// It prints codec names and file names only, never a URL, a token or a play session.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT, call, makeSaver, makeScrubber, readCredentials, sleep } from "./fixture-recording.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "..", "packages", "core", "tests", "fixtures");
const sha = /^x-jellyscale-commit:\s*([0-9a-f]{40})\b/m.exec(readFileSync(join(here, "docker-compose.yml"), "utf8"))?.[1];
if (!sha) throw new Error("docker-compose.yml has no x-jellyscale-commit of 40 hex characters");

const servers = [
  { name: "jellyfin-10-11", kind: "jellyfin", outDir: join(fixturesRoot, "jellyfin", "10.11.7"), folder: "10.11.7", fakeServerId: "server-1011" },
  { name: "jellyfin-12", kind: "jellyfin", outDir: join(fixturesRoot, "jellyfin", "12.4.0"), folder: "12.4.0", fakeServerId: "server-124" },
  { name: "jellyscale", kind: "jellyscale", outDir: join(fixturesRoot, "jellyscale", sha.slice(0, 12)), folder: sha.slice(0, 12), fakeServerId: "server-jellyscale" },
];

const DEVICE_ID = "octave-fixtures";
const MAX = 1000000000;
// Below every sample's bitrate: H.264 about 491 kbit/s, no decoder about 449, AV1 about 686, HEVC about 92.
const LIMIT = 50000;

const SAMPLES = {
  "h264": { fakeId: "item-h264", path: "Synthetic H264 (2024).mkv" },
  "hevc-hdr10": { fakeId: "item-hevc", path: "Synthetic HEVC HDR10 (2024).mkv" },
  "av1": { fakeId: "item-av1", path: "Synthetic AV1 (2024).mkv" },
  "no-decoder": { fakeId: "item-no-decoder", path: "Synthetic No Decoder (2024).mkv" },
  "iso": { fakeId: "item-iso", path: "Synthetic ISO (2024).iso" },
  "bluray-folder": { fakeId: "item-bluray", path: "Synthetic BluRay (2024)", jellyscalePath: "BDMV/STREAM/00000.m2ts" },
};

const FIRST = { EnableDirectPlay: true, AllowVideoStreamCopy: true, AllowAudioStreamCopy: true };
const FORCED_VIDEO = { EnableDirectPlay: false, AllowVideoStreamCopy: false, AllowAudioStreamCopy: true };
const FORCED_BOTH = { EnableDirectPlay: false, AllowVideoStreamCopy: false, AllowAudioStreamCopy: false };
const DISC_FALLBACK = { EnableDirectPlay: false, AllowVideoStreamCopy: true, AllowAudioStreamCopy: true };

const JELLYFIN_ROWS = [
  { kind: "encode", file: "encode-target-hevc-hdr10", sample: "hevc-hdr10", flags: FORCED_VIDEO, bitrate: MAX, namesSource: true },
  { kind: "encode", file: "encode-target-av1", sample: "av1", flags: FORCED_VIDEO, bitrate: MAX, namesSource: true },
  { kind: "encode", file: "encode-target-no-decoder", sample: "no-decoder", flags: FIRST, bitrate: LIMIT, namesSource: false },
  { kind: "answer", file: "device-disc-conversion-iso", sample: "iso", flags: FORCED_BOTH, bitrate: MAX, namesSource: true },
  { kind: "answer", file: "device-disc-conversion-bluray-folder", sample: "bluray-folder", flags: FORCED_BOTH, bitrate: MAX, namesSource: true },
];

const JELLYSCALE_ROWS = [
  { kind: "encode", file: "encode-target-h264-limited", sample: "h264", flags: FIRST, bitrate: LIMIT, namesSource: false },
  { kind: "encode", file: "encode-target-h264-limited-forced", sample: "h264", flags: FORCED_VIDEO, bitrate: LIMIT, namesSource: true },
  { kind: "encode", file: "encode-target-hevc-hdr10", sample: "hevc-hdr10", flags: FIRST, bitrate: LIMIT, namesSource: false },
  { kind: "encode", file: "encode-target-av1", sample: "av1", flags: FIRST, bitrate: LIMIT, namesSource: false },
  { kind: "encode", file: "encode-target-no-decoder", sample: "no-decoder", flags: FIRST, bitrate: LIMIT, namesSource: false },
];

const PROFILE = {
  Name: "Octave",
  MaxStreamingBitrate: MAX,
  MaxStaticBitrate: MAX,
  DirectPlayProfiles: [{ Type: "Video" }, { Type: "Audio" }],
  TranscodingProfiles: [
    {
      Type: "Video",
      Container: "mp4",
      Protocol: "hls",
      Context: "Streaming",
      VideoCodec: "h264,hevc,av1,vp9",
      AudioCodec: "aac,ac3,eac3,opus,flac,mp3",
      EnableSubtitlesInManifest: false,
    },
    { Type: "Audio", Container: "mp4", Protocol: "hls", Context: "Streaming", AudioCodec: "aac" },
  ],
  ContainerProfiles: [],
  CodecProfiles: [],
  SubtitleProfiles: [
    ...["srt", "ass", "ssa", "vtt", "sub", "pgssub"].map((Format) => ({ Format, Method: "External" })),
    ...["srt", "ass", "ssa", "pgssub", "dvdsub", "vtt"].map((Format) => ({ Format, Method: "Embed" })),
  ],
};

function requestFor(userId, row, mediaSourceId) {
  const flags = { ...row.flags, EnableDirectStream: true, EnableTranscoding: true, AutoOpenLiveStream: false };
  const query = { ...flags, UserId: userId, StartTimeTicks: 0, MaxStreamingBitrate: row.bitrate };
  if (mediaSourceId) query.MediaSourceId = mediaSourceId;
  const body = {
    ...query,
    AlwaysBurnInSubtitleWhenTranscoding: false,
    DeviceProfile: { ...PROFILE, MaxStreamingBitrate: row.bitrate },
  };
  return { query, body };
}

const CREDENTIAL_PARAM = /^(api_?key|apitoken|token|accesstoken|access_token|x-emby-token)$/i;

// The URL with every credential parameter dropped: the header authenticates, never the URL.
function headerOnly(base, raw) {
  const url = new URL(raw, base);
  for (const name of [...url.searchParams.keys()]) if (CREDENTIAL_PARAM.test(name)) url.searchParams.delete(name);
  return url;
}

async function getText(token, url) {
  const response = await fetch(url, { redirect: "manual", headers: { Authorization: `${CLIENT}, Token="${token}"` } });
  const text = await response.text();
  return { status: response.status, text };
}

function codecsOf(master) {
  return master
    .split("\n")
    .filter((line) => line.startsWith("#EXT-X-STREAM-INF"))
    .map((line) => /CODECS="([^"]*)"/.exec(line)?.[1] ?? "")
    .map((value) => value.split(",").map((codec) => codec.trim()).filter(Boolean));
}

function urisOf(playlist) {
  return playlist.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}

async function transcodingInfo(base, token) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const sessions = await call(base, token, "GET", "/Sessions", { query: { deviceId: DEVICE_ID } }).catch(() => []);
    const info = (sessions ?? []).map((session) => session.TranscodingInfo).find(Boolean);
    if (info) {
      return {
        VideoCodec: info.VideoCodec ?? null,
        AudioCodec: info.AudioCodec ?? null,
        IsVideoDirect: info.IsVideoDirect ?? null,
        IsAudioDirect: info.IsAudioDirect ?? null,
      };
    }
    await sleep(1000);
  }
  return null;
}

// Fetches the master, the first variant and its first segment, reads TranscodingInfo, and stops the job.
async function play(base, token, transcodingUrl, playSessionId) {
  const masterUrl = headerOnly(base, transcodingUrl);
  const master = await getText(token, masterUrl);
  const result = { status: master.status, codecs: master.status === 200 ? codecsOf(master.text) : [] };
  let info = null;
  try {
    const [variant] = master.status === 200 ? urisOf(master.text) : [];
    if (variant) {
      const variantUrl = headerOnly(base, new URL(variant, masterUrl).toString());
      const media = await getText(token, variantUrl);
      const [segment] = media.status === 200 ? urisOf(media.text) : [];
      if (segment) await getText(token, headerOnly(base, new URL(segment, variantUrl).toString()));
      info = await transcodingInfo(base, token);
    }
  } finally {
    await call(base, token, "DELETE", "/Videos/ActiveEncodings", { query: { deviceId: DEVICE_ID, playSessionId } }).catch(() => undefined);
  }
  return { master: result, transcodingInfo: info };
}

async function findItems(server, base, token, rows) {
  if (server.kind === "jellyfin") await call(base, token, "POST", "/Library/Refresh");
  const wanted = [...new Set(rows.map((row) => row.sample))];
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const result = await call(base, token, "GET", "/Items", {
      query: { Recursive: true, IncludeItemTypes: "Movie,Video,Episode", Fields: "Path,MediaSources" },
    });
    const items = result.Items ?? [];
    const found = new Map();
    for (const name of wanted) {
      const sample = SAMPLES[name];
      const suffix = server.kind === "jellyscale" && sample.jellyscalePath ? sample.jellyscalePath : sample.path;
      const item = items.find((candidate) => candidate.Path?.replace(/\\/g, "/").endsWith(suffix));
      if (item) found.set(name, item);
    }
    if (found.size === wanted.length) return found;
    if (server.kind === "jellyscale" && attempt > 2) return found;
    await sleep(2000);
  }
  throw new Error(`${server.name}: library scan did not finish`);
}

const credentials = readCredentials();
for (const server of servers) {
  const base = credentials[`${server.name}_url`];
  const auth = await call(base, undefined, "POST", "/Users/AuthenticateByName", {
    body: { Username: credentials[`${server.name}_username`], Pw: credentials[`${server.name}_password`] },
  });
  const token = auth.AccessToken;
  const userId = auth.User.Id;
  const info = await call(base, undefined, "GET", "/System/Info/Public");
  console.log(`${server.name}: ${info.ProductName ?? "server"} ${info.Version}`);
  const rows = server.kind === "jellyfin" ? JELLYFIN_ROWS : JELLYSCALE_ROWS;
  const items = await findItems(server, base, token, rows);

  const knownIds = new Map();
  for (const [name, item] of items) knownIds.set(item.Id.toLowerCase().replace(/-/g, ""), SAMPLES[name].fakeId);
  const scrub = makeScrubber({
    tokens: [token],
    host: new URL(base).host,
    fakeUserIds: [{ real: userId.toLowerCase().replace(/-/g, ""), fake: "user-test" }],
    fakeServerId: { real: String(info.Id).toLowerCase().replace(/-/g, ""), fake: server.fakeServerId },
    knownIds,
    serverNames: [info.ServerName].filter(Boolean),
  });
  mkdirSync(server.outDir, { recursive: true });
  const save = makeSaver({ outDir: server.outDir, folder: server.folder, scrub, secrets: [token] });

  for (const row of rows) {
    const item = items.get(row.sample);
    if (!item) {
      console.log(`  ${row.file}: no item for ${row.sample}; not written`);
      continue;
    }
    const mediaSourceId = row.namesSource ? item.MediaSources?.[0]?.Id : undefined;
    const request = requestFor(userId, row, mediaSourceId);
    const answer = await call(base, token, "POST", `/Items/${item.Id}/PlaybackInfo`, request);
    if (row.kind === "answer") {
      save(row.file, answer);
      continue;
    }
    const source = (answer.MediaSources ?? []).find((candidate) => !mediaSourceId || candidate.Id === mediaSourceId) ?? answer.MediaSources?.[0];
    const flags = { ...row.flags, MaxStreamingBitrate: row.bitrate, MediaSourceIdNamed: Boolean(mediaSourceId) };
    // Jellyscale names itself Jellyfin Server in /System/Info/Public, so the compose service names the server.
    const record = { server: server.name, version: info.Version, sample: row.sample, request: flags };
    if (!source?.TranscodingUrl) {
      console.log(`  ${row.file}: no TranscodingUrl (direct play offered: ${source?.SupportsDirectPlay === true})`);
      save(row.file, { ...record, recorded: false, why: "the answer holds no TranscodingUrl", answer });
      continue;
    }
    // Before a fetch: one PlaySessionId and one job per row.
    const played = await play(base, token, source.TranscodingUrl, answer.PlaySessionId);
    const listed = new URL(source.TranscodingUrl, base).searchParams;
    console.log(`  ${row.file}: VideoCodec=${listed.get("VideoCodec") ?? listed.get("videocodec")} CODECS=${JSON.stringify(played.master.codecs)} TranscodingInfo=${played.transcodingInfo ? `${played.transcodingInfo.VideoCodec}/${played.transcodingInfo.AudioCodec}` : "none"}`);
    save(row.file, { ...record, recorded: true, answer, ...played });
  }
}
