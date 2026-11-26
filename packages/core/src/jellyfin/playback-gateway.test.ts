import { describe, expect, it, vi } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import type { LibraryItem } from "../domain/catalog";
import type { PlaybackPlan, PlaybackSnapshot } from "../domain/playback";
import type { ViewingSource } from "../player/viewing";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";
import { playbackGatewayOf } from "./playback-gateway";

// T8-03 D3: the one adapter from JellyfinGateway to the coordinator's PlaybackGateway port, through which Play
// negotiates (item 1) and the playstate reports leave (items 2 and 3).

const item: LibraryItem = { id: "one", name: "One", type: "Movie", resumePositionTicks: 0, played: false };
const plan: PlaybackPlan = {
  itemId: "one",
  title: "One",
  streamUrl: "https://media.test/Videos/one/stream?Static=true",
  mediaSourceId: "source",
  playSessionId: "session",
  startPositionTicks: 0,
  tracks: [],
  delivery: "static",
  playMethod: "DirectPlay",
  conversionReasons: [],
};
const snapshot: PlaybackSnapshot = {
  positionSeconds: 42,
  paused: false,
  buffering: false,
  volume: 100,
  muted: false,
  tracks: [],
  diagnostics: { decodeMode: "software", decodeLabel: "Software — CPU", droppedFrames: 0 },
};

function negotiating() {
  const gateway = new JellyfinGateway("https://media.test", webCrypto, new FakeTransport(), "install-1");
  const negotiate = vi.spyOn(gateway, "createPlaybackPlan").mockResolvedValue(plan);
  return { gateway, negotiate };
}

async function signedIn() {
  const transport = new FakeTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "top-secret", User: { Id: "user-1", Name: "Louise" } });
  const gateway = new JellyfinGateway("https://media.test", webCrypto, transport, "install-1");
  await gateway.login("Louise", "password");
  return { gateway, transport };
}

describe("playbackGatewayOf", () => {
  it("T8-03 item 1: negotiates with no media source and no options when there is no selection", async () => {
    const { gateway, negotiate } = negotiating();
    const source: ViewingSource = playbackGatewayOf(gateway);
    const { signal } = new AbortController();

    await expect(source.createPlaybackPlan(item, 120, signal)).resolves.toBe(plan);

    expect(negotiate.mock.calls).toStrictEqual([[item, 120, signal, undefined, {}]]);
  });

  it("T8-03 item 1: maps a selection to the gateway's media source and options field by field", async () => {
    const { gateway, negotiate } = negotiating();
    const { signal } = new AbortController();

    await playbackGatewayOf(gateway).createPlaybackPlan(item, 120, signal, {
      mediaSourceId: "source-2",
      audioStreamIndex: 2,
      subtitleStreamIndex: -1,
      keepDirectPlay: true,
    });

    expect(negotiate.mock.calls).toStrictEqual([
      [item, 120, signal, "source-2", { audioStreamIndex: 2, subtitleStreamIndex: -1, keepDirectPlay: true }],
    ]);
  });

  it.each([
    ["only the media source", {}],
    ["the first audio stream and nothing else", { audioStreamIndex: 0 }],
    ["a subtitle stream and nothing else", { subtitleStreamIndex: 3 }],
  ])("T8-03 item 1: leaves an absent selection field absent, given %s", async (_name, streams) => {
    const { gateway, negotiate } = negotiating();
    const { signal } = new AbortController();

    await playbackGatewayOf(gateway).createPlaybackPlan(item, 0, signal, { mediaSourceId: "source-2", ...streams });

    expect(negotiate.mock.calls).toStrictEqual([[item, 0, signal, "source-2", streams]]);
  });

  it("T8-03 item 1: answers the session id and the item read from the gateway it wraps", async () => {
    const { gateway, transport } = await signedIn();
    transport.responses.set("GET /Items/one", { Id: "one", Name: "One", Type: "Movie" });
    const source: ViewingSource = playbackGatewayOf(gateway);

    expect(source.sessionId()).toBe(gateway.sessionId());
    await expect(source.itemDetail("one")).resolves.toMatchObject({ id: "one", type: "Movie", title: "One" });
  });

  it("T8-03 item 2: sends the three reports and the encode stop through the gateway it wraps", async () => {
    const { gateway, transport } = await signedIn();
    const source: ViewingSource = playbackGatewayOf(gateway);
    const sentBefore = transport.requests.length;

    await source.reportStart(plan, snapshot);
    await source.reportProgress(plan, snapshot);
    await source.reportStopped(plan, snapshot, undefined, false);
    await source.stopActiveEncoding("session");

    expect(transport.requests.slice(sentBefore).map((sent) => `${sent.method} ${sent.url}`)).toEqual([
      "POST /Sessions/Playing",
      "POST /Sessions/Playing/Progress",
      "POST /Sessions/Playing/Stopped",
      "DELETE /Videos/ActiveEncodings",
    ]);
  });

  it("T8-03 item 3: sends Failed with the stopped report only", async () => {
    const { gateway, transport } = await signedIn();
    const source: ViewingSource = playbackGatewayOf(gateway);
    const sentBefore = transport.requests.length;

    await source.reportStart(plan, snapshot);
    await source.reportProgress(plan, snapshot);
    await source.reportStopped(plan, snapshot, undefined, true);

    const [start, progress, stopped] = transport.requests.slice(sentBefore);
    expect(start?.data).not.toHaveProperty("Failed");
    expect(progress?.data).not.toHaveProperty("Failed");
    expect(stopped?.data).toMatchObject({ Failed: true });
  });
});
