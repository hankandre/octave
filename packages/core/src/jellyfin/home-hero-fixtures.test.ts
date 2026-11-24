import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MediaCard } from "../domain/catalog";
import { heroFacts, loadHeroExtras } from "../domain/home-hero";
import { runtimeLabel } from "../domain/media-format";
import { webCrypto } from "../adapters/web-crypto";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";

// T5-03 item 9: the hero's facts and overview from the recorded item-detail answers of Jellyfin 10.11.7, 12.4.0 and Jellyscale
// (pin b920b193cd6f), replayed through the real gateway on a fake transport. The expected words are read from the recordings:
// every one of them has ProductionYear 2024 and RunTimeTicks 100210000, and none holds an Overview, so the hero shows no
// overview for them. The 12.4.0 and 10.11.7 hevc-hdr10 files name VideoRangeType HDR10 on a 1280 x 720 stream, so they add the
// range but not 4K; the SDR files add nothing. The recorded runtime is a ten-second clip, whatever `runtimeLabel` makes of it.
const fixturesRoot = join(__dirname, "../../tests/fixtures");
const composePath = join(__dirname, "../../../../tests/integration/docker-compose.yml");
const ORIGIN = "http://127.0.0.1:8096";
const RECORDED_TICKS = 100210000;

function pinFolder(): string {
  const sha = /^x-jellyscale-commit:\s*([0-9a-f]{40})\b/m.exec(readFileSync(composePath, "utf8"))?.[1];
  if (!sha) throw new Error("docker-compose.yml has no x-jellyscale-commit of 40 hex characters");
  return sha.slice(0, 12);
}

interface Recording {
  label: string;
  dir: string;
  file: string;
  // The range word the recording's video stream gives, or none.
  range?: string;
}

const RECORDINGS: Recording[] = [
  { label: "Jellyfin 10.11.7 hevc-hdr10", dir: join(fixturesRoot, "jellyfin", "10.11.7"), file: "item-detail-no-fields-hevc-hdr10.json", range: "HDR10" },
  { label: "Jellyfin 12.4.0 hevc-hdr10", dir: join(fixturesRoot, "jellyfin", "12.4.0"), file: "item-detail-no-fields-hevc-hdr10.json", range: "HDR10" },
  { label: "Jellyfin 10.11.7 multi-version", dir: join(fixturesRoot, "jellyfin", "10.11.7"), file: "item-detail-no-fields-multi-version.json" },
  { label: "Jellyfin 12.4.0 multi-version", dir: join(fixturesRoot, "jellyfin", "12.4.0"), file: "item-detail-no-fields-multi-version.json" },
  { label: "Jellyfin 12.4.0 multitrack", dir: join(fixturesRoot, "jellyfin", "12.4.0"), file: "item-detail-no-fields-multitrack.json" },
  { label: "Jellyscale h264", dir: join(fixturesRoot, "jellyscale", pinFolder()), file: "item-detail-h264.json" },
  { label: "Jellyscale multitrack", dir: join(fixturesRoot, "jellyscale", pinFolder()), file: "item-detail-multitrack.json" },
];

async function replay(recording: Recording) {
  const body = JSON.parse(readFileSync(join(recording.dir, recording.file), "utf8")) as { Id: string; Overview?: string; ProductionYear?: number; RunTimeTicks?: number };
  const transport = new FakeTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "REDACTED", User: { Id: "user-test", Name: "octave-test" } });
  transport.responses.set(`GET /Items/${encodeURIComponent(body.Id)}`, body);
  const gateway = new JellyfinGateway(ORIGIN, webCrypto, transport, "install-1");
  await gateway.login("octave-test", "not-a-real-password");
  return { gateway, transport, body };
}

describe.each(RECORDINGS)("the hero's facts from $label", (recording) => {
  it("T5-03 item 9: the recording gives the year, the runtime and the range the test writer read from it, and no overview", async () => {
    const { gateway, body } = await replay(recording);
    expect(body.ProductionYear).toBe(2024);
    expect(body.RunTimeTicks).toBe(RECORDED_TICKS);
    expect(body.Overview).toBeUndefined();
    const card: MediaCard = { id: body.Id, kind: "Movie", title: "Synthetic", subtitle: "2024", aspectRatio: 2 / 3 };
    const extras = await loadHeroExtras(gateway, { rule: "row", card }, new AbortController().signal);
    expect(extras.detail?.overview).toBeUndefined();
    const parts = ["2024", runtimeLabel(RECORDED_TICKS), ...(recording.range ? [recording.range] : [])];
    expect(heroFacts(card, extras.detail)).toBe(parts.join(" · "));
  });

  it("T5-03 item 9: the hero's read is the one GET /Items/{id} with the user id and nothing else", async () => {
    const { gateway, transport, body } = await replay(recording);
    const card: MediaCard = { id: body.Id, kind: "Movie", title: "Synthetic", aspectRatio: 2 / 3 };
    await loadHeroExtras(gateway, { rule: "row", card }, new AbortController().signal);
    const reads = transport.requests.filter((request) => request.method === "GET");
    expect(reads.map((request) => request.url)).toEqual([`/Items/${encodeURIComponent(body.Id)}`]);
    expect(reads[0]?.params).toEqual({ userId: "user-test" });
  });
});
