// Records the one forced-conversion answer T2-07's recorder cannot: device-conversion-av1 (T8-24).
// Usage: pnpm samples:generate && pnpm fixture:up && pnpm fixture:setup && node tests/integration/record-device-conversion-av1.mjs
// The request is the one record-fixtures.mjs sends for device-conversion-h264: the decision 0002 profile and flags
// with EnableDirectPlay and AllowVideoStreamCopy false, and the item's first media source named in the body.
// OCTAVE_PROFILE, CONVERSION_PROFILE and CONVERSION_FLAGS (record-fixtures.mjs:43-93) and conversionRequestFor
// (record-fixtures.mjs:175-199) are copied here because that frozen file runs on import and cannot be imported.
// Credentials come from tests/integration/.credentials and are never printed.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { call, makeSaver, makeScrubber, readCredentials, sleep } from "./fixture-recording.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outRoot = join(here, "..", "..", "packages", "core", "tests", "fixtures", "jellyfin");

const servers = [
  { name: "jellyfin-10-11", folder: "10.11.7", fakeServerId: "server-1011" },
  { name: "jellyfin-12", folder: "12.4.0", fakeServerId: "server-124" },
];

const FILE = "device-conversion-av1";
const FAKE_ID = "item-av1";
const PATH = "Synthetic AV1 (2024).mkv";

const OCTAVE_PROFILE = {
  Name: "Octave",
  MaxStreamingBitrate: 1000000000,
  MaxStaticBitrate: 1000000000,
  DirectPlayProfiles: [{ Type: "Video" }, { Type: "Audio" }],
  TranscodingProfiles: [],
  ContainerProfiles: [],
  CodecProfiles: [],
  SubtitleProfiles: [
    ...["srt", "ass", "ssa", "vtt", "sub", "pgssub"].map((Format) => ({ Format, Method: "External" })),
    ...["srt", "ass", "ssa", "pgssub", "dvdsub", "vtt"].map((Format) => ({ Format, Method: "Embed" })),
  ],
};

const CONVERSION_PROFILE = {
  ...OCTAVE_PROFILE,
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
};

const CONVERSION_FLAGS = {
  EnableDirectPlay: true,
  EnableDirectStream: true,
  EnableTranscoding: true,
  AllowVideoStreamCopy: true,
  AllowAudioStreamCopy: true,
  AutoOpenLiveStream: false,
};

function forcedRequestFor(userId, mediaSourceId) {
  const flags = { ...CONVERSION_FLAGS, EnableDirectPlay: false, AllowVideoStreamCopy: false };
  const body = {
    ...flags,
    AlwaysBurnInSubtitleWhenTranscoding: false,
    UserId: userId,
    StartTimeTicks: 0,
    MaxStreamingBitrate: 1000000000,
    DeviceProfile: CONVERSION_PROFILE,
    MediaSourceId: mediaSourceId,
  };
  const query = { ...flags, UserId: userId, StartTimeTicks: 0, MaxStreamingBitrate: 1000000000 };
  return { body, query };
}

async function findItem(base, token) {
  await call(base, token, "POST", "/Library/Refresh");
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const result = await call(base, token, "GET", "/Items", {
      query: { Recursive: true, IncludeItemTypes: "Movie,Video,Episode", Fields: "Path,MediaSources" },
    });
    const item = (result.Items ?? []).find((i) => i.Path?.endsWith(PATH));
    if (item) return item;
    await sleep(2000);
  }
  throw new Error(`library scan did not finish; missing: ${PATH}`);
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
  console.log(`${server.name}: Jellyfin ${info.Version}`);

  const item = await findItem(base, token);
  const scrub = makeScrubber({
    tokens: [token],
    host: new URL(base).host,
    fakeUserIds: [{ real: userId.toLowerCase(), fake: "user-test" }],
    fakeServerId: { real: info.Id.toLowerCase(), fake: server.fakeServerId },
    knownIds: new Map([[item.Id.toLowerCase(), FAKE_ID]]),
    serverNames: [info.ServerName].filter(Boolean),
  });
  const outDir = join(outRoot, server.folder);
  mkdirSync(outDir, { recursive: true });
  const save = makeSaver({ outDir, folder: server.folder, scrub, secrets: [token] });
  const request = forcedRequestFor(userId, item.MediaSources?.[0]?.Id);
  save(FILE, await call(base, token, "POST", `/Items/${item.Id}/PlaybackInfo`, request));
}
