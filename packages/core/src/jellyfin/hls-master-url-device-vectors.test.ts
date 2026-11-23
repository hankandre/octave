import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlaybackPlan } from "../domain/playback";
import type { PlayerCapabilities } from "../domain/player-engine";
import { listOf, negotiate } from "./device-test-support";
import { rebuildMasterUrl } from "./hls-url";
import type { PlaybackInfoResponse } from "./types";

// T8-24: the plans a forced conversion produces are shared HLS vectors, in a file beside the frozen
// hls-master-urls.json (T2-06). Every native validator deserializes each plan and accepts its master URL
// (Kotlin in T8-08). Regenerate after a deliberate negotiation change with
// OCTAVE_WRITE_DEVICE_HLS_VECTORS=1 pnpm --filter @octave/core exec vitest run src/jellyfin/hls-master-url-device-vectors.test.ts
// Every test reads the vector file and the README inside its own body, never at module load: the write flag
// writes the file in the item 1 test, and a module-level read or throw would judge the old file or turn a
// failed assertion into an error.
const FIXTURES = join(__dirname, "../../tests/fixtures");
const VECTOR_FILE = join(FIXTURES, "hls-master-urls-device-conversion.json");
const README_FILE = join(FIXTURES, "README.md");
const FIXTURE_ROOT = join(FIXTURES, "jellyfin");

const VERSIONS = ["10.11.7", "12.4.0"];
const SERVERS = ["http://127.0.0.1:8096", "https://media.test/jellyfin"];
const HOSTS = ["127.0.0.1:8096", "media.test"];
const VIDEO = ["h264", "hevc", "av1", "vp9"] as const;
const AUDIO = ["aac", "ac3", "eac3", "opus", "flac", "mp3"] as const;

// The device cannot play the sample's video: every video codec but that one, and for the H.264 sample an h264
// decoder of another profile.
const SAMPLES = [
  { sample: "h264", itemId: "item-h264", first: "conversion-h264", forced: "device-conversion-h264", missing: "h264" },
  { sample: "hevc-hdr10", itemId: "item-hevc", first: "conversion-hevc-hdr10", forced: "device-conversion-hevc-hdr10", missing: "hevc" },
  { sample: "av1", itemId: "item-av1", first: "conversion-av1", forced: "device-conversion-av1", missing: "av1" },
] as const;

const DESCRIPTION =
  "Forced-conversion HLS master URLs (T8-24). `vectors`: the plans packages/core/src/jellyfin/hls-master-url-device-vectors.test.ts builds when the server offers direct play, the device lacks the sample's video codec, and the second PlaybackInfo is answered with a conversion (Jellyfin 10.11.7 and 12.4.0; H.264, HEVC and AV1). Every native validator deserializes each plan and accepts its master URL (Kotlin in T8-08). The refusals are in hls-master-urls.json. See packages/core/tests/fixtures/README.md.";

type HlsPlan = Extract<PlaybackPlan, { delivery: "hls" }>;

interface Vector {
  name: string;
  plan: HlsPlan;
}

function answer(version: string, file: string): PlaybackInfoResponse {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, version, `${file}.json`), "utf8")) as PlaybackInfoResponse;
}

const EXPECTED_NAMES = VERSIONS.flatMap((version) => SAMPLES.flatMap(({ forced }) => SERVERS.map((server) => `${version} ${forced} ${server}`)));

async function buildVectors(): Promise<{ vectors: Vector[]; postCounts: number[] }> {
  const vectors: Vector[] = [];
  const postCounts: number[] = [];
  for (const version of VERSIONS) {
    for (const { itemId, first, forced, missing } of SAMPLES) {
      const lacking = listOf(
        VIDEO.filter((codec) => codec !== missing),
        AUDIO,
      );
      // The conversion is encoded into H.264, so the list that cannot play the H.264 sample (it is High) still
      // decodes H.264: its one h264 decoder states another profile (T8-23).
      const capabilities: PlayerCapabilities =
        missing === "h264" && lacking.probe === "complete"
          ? { ...lacking, videoDecoders: [{ codec: "h264", hardware: true, profile: "Constrained Baseline" }, ...lacking.videoDecoders] }
          : lacking;
      for (const server of SERVERS) {
        const { transport, result } = await negotiate(itemId, [answer(version, first), answer(version, forced)], capabilities, { server });
        if (result instanceof Error) throw result;
        postCounts.push(transport.posts.length);
        vectors.push({ name: `${version} ${forced} ${server}`, plan: result as HlsPlan });
      }
    }
  }
  return { vectors, postCounts };
}

// undefined when the file is missing, so a red run fails by assertion and never by ENOENT.
function committedVectors(): Vector[] | undefined {
  if (!existsSync(VECTOR_FILE)) return undefined;
  return (JSON.parse(readFileSync(VECTOR_FILE, "utf8")) as { vectors: Vector[] }).vectors;
}

function vectorFileText(): string | undefined {
  return existsSync(VECTOR_FILE) ? readFileSync(VECTOR_FILE, "utf8") : undefined;
}

function contextOf(plan: HlsPlan) {
  return {
    serverUrl: plan.serverUrl,
    itemId: plan.itemId,
    mediaSourceId: plan.mediaSourceId,
    mediaKind: plan.mediaKind,
    playSessionId: plan.playSessionId,
  };
}

describe("T8-24 item 1: the forced-conversion answers are shared master-URL vectors", () => {
  it.each(VERSIONS)("the AV1 forced answer of Jellyfin %s is an HLS conversion with video copy off", (version) => {
    const source = answer(version, "device-conversion-av1").MediaSources?.[0];
    expect(source?.SupportsDirectPlay).toBe(false);
    expect(source?.TranscodingSubProtocol).toBe("hls");
    const url = new URL(source?.TranscodingUrl ?? "", "http://server.test");
    expect(url.pathname).toBe("/videos/item-av1/master.m3u8");
    expect(url.searchParams.get("allowVideoStreamCopy")?.toLowerCase()).toBe("false");
    expect(url.searchParams.get("PlaySessionId")).toBe("play-session-1");
  });

  it("the vector file holds the 12 plans the gateway builds today", async () => {
    const { vectors, postCounts } = await buildVectors();
    expect(vectors.map(({ name }) => name)).toEqual(EXPECTED_NAMES);
    expect(postCounts.every((count) => count === 2)).toBe(true);
    for (const { name, plan } of vectors) {
      expect(plan, name).toMatchObject({ delivery: "hls", playMethod: "Transcode", clientConversionReason: "DeviceCannotPlay" });
      expect(plan, name).not.toHaveProperty("authorization");
    }
    // Both base paths reach the vectors: the master URL keeps `/jellyfin`.
    expect(vectors.some(({ plan }) => new URL(plan.streamUrl).pathname.startsWith("/jellyfin/videos/"))).toBe(true);
    if (process.env.OCTAVE_WRITE_DEVICE_HLS_VECTORS === "1") {
      writeFileSync(VECTOR_FILE, `${JSON.stringify({ description: DESCRIPTION, vectors }, null, 2)}\n`);
    }
    const committed = committedVectors();
    expect(committed, "packages/core/tests/fixtures/hls-master-urls-device-conversion.json exists").toBeDefined();
    expect(committed?.map(({ name }) => name)).toEqual(EXPECTED_NAMES);
    expect(committed).toEqual(vectors);
  });
});

describe("T8-24 item 3: the core's master-URL check accepts every new vector", () => {
  it("the file holds 12 vectors", () => {
    const committed = committedVectors();
    expect(committed, "the vector file exists").toBeDefined();
    expect(committed).toHaveLength(12);
  });

  it("every vector rebuilds to its own streamUrl", () => {
    const committed = committedVectors();
    expect(committed, "the vector file exists").toBeDefined();
    expect(committed?.length).toBe(12);
    for (const { name, plan } of committed ?? []) {
      const result = rebuildMasterUrl(plan.streamUrl, contextOf(plan));
      expect(result.ok, name).toBe(true);
      expect(result.ok ? result.url : undefined, name).toBe(plan.streamUrl);
    }
  });

  it("the fixtures README records the file's SHA-256", () => {
    const text = vectorFileText();
    expect(text, "the vector file exists").toBeDefined();
    const sha = createHash("sha256")
      .update(text ?? "")
      .digest("hex");
    expect(readFileSync(README_FILE, "utf8")).toContain(sha);
  });
});

describe("T8-24 item 4: the new vectors hold only synthetic values", () => {
  const CREDENTIAL = /(?<![A-Za-z0-9])(?:ApiKey|api_key|access_token|Token|X-Emby-Token|ApiToken|AccessToken)(?:=|%3D)/i;
  const ITEMS = ["item-h264", "item-hevc", "item-av1"];

  function stringsOf(value: unknown, key = ""): [string, string][] {
    if (typeof value === "string") return [[key, value]];
    if (Array.isArray(value)) return value.flatMap((entry) => stringsOf(entry, key));
    if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => stringsOf(v, k));
    return [];
  }

  it("the file's text has no credential, token marker or server path", () => {
    const text = vectorFileText();
    expect(text, "the vector file exists").toBeDefined();
    expect(text).not.toMatch(CREDENTIAL);
    expect(text).not.toContain("REDACTED");
    expect(text).not.toContain("test-token");
    expect(text).not.toContain("/media/");
  });

  it("every address is one of the two synthetic servers", () => {
    const committed = committedVectors();
    expect(committed, "the vector file exists").toBeDefined();
    expect(committed).toHaveLength(12);
    for (const { name, plan } of committed ?? []) {
      expect(SERVERS, name).toContain(plan.serverUrl);
      const server = new URL(plan.serverUrl);
      const stream = new URL(plan.streamUrl);
      expect(HOSTS, name).toContain(server.host);
      expect(HOSTS, name).toContain(stream.host);
      expect(stream.origin, name).toBe(server.origin);
    }
  });

  it("no string but serverUrl and streamUrl holds a scheme separator", () => {
    const committed = committedVectors();
    expect(committed, "the vector file exists").toBeDefined();
    expect(committed).toHaveLength(12);
    for (const { name, plan } of committed ?? []) {
      // This holds while these samples have no external subtitle: a plan with one carries tracks[].deliveryUrl
      // (the ass and sidecar plans of hls-master-urls.json do). A later sample with a subtitle track needs this
      // predicate changed deliberately, not a failure read as a leak.
      for (const [key, text] of stringsOf(plan)) {
        if (key === "serverUrl" || key === "streamUrl") continue;
        expect(text, `${name} ${key}`).not.toContain("://");
      }
    }
  });

  it("session, device, item and title values are the scrubbed fakes", () => {
    const committed = committedVectors();
    expect(committed, "the vector file exists").toBeDefined();
    expect(committed).toHaveLength(12);
    for (const { name, plan } of committed ?? []) {
      const url = new URL(plan.streamUrl);
      expect(plan.playSessionId, name).toBe("play-session-1");
      expect(url.searchParams.getAll("PlaySessionId"), name).toEqual(["play-session-1"]);
      expect(url.searchParams.getAll("DeviceId"), name).toEqual(["octave-fixtures"]);
      expect(ITEMS, name).toContain(plan.itemId);
      expect(ITEMS, name).toContain(plan.mediaSourceId);
      expect(plan.title, name).toBe("Fixture");
      for (const track of plan.tracks ?? []) expect(track.displayTitle, name).not.toContain("/");
    }
  });
});

// Green from the start; no `run` selects it. T8-24 item 2: hls-master-urls.json is frozen by T2-06 and stays byte
// for byte as it is. A ruled regeneration of it (a new PlaybackPlan field, backlog entry 102) also regenerates this
// task's file and changes only the three constants below.
describe("T8-24 frozen file: hls-master-urls.json is unchanged", () => {
  const FROZEN_SHA256 = "b525504c72f23c66f7ba21d78f6607f7e8a957bc81d3a55e2fa8e4eab62e120d";
  const FROZEN_VECTORS = 44;
  const FROZEN_REFUSALS = 64;

  it("keeps its SHA-256 and its counts", () => {
    const text = readFileSync(join(FIXTURES, "hls-master-urls.json"));
    expect(createHash("sha256").update(text).digest("hex")).toBe(FROZEN_SHA256);
    const file = JSON.parse(text.toString("utf8")) as { vectors: unknown[]; refusals: unknown[] };
    expect(file.vectors).toHaveLength(FROZEN_VECTORS);
    expect(file.refusals).toHaveLength(FROZEN_REFUSALS);
  });
});
