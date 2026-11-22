// @vitest-environment node
// T8-22 review follow-up: G1's tab and backslash vectors, and each half of G2 on its own. Node's URL parser
// maps a non-ASCII host onto ASCII, so R2 is reached only through a stand-in URL that reports one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import type { LibraryItem } from "../domain/catalog";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";
import { rebuildMasterUrl } from "./hls-url";

const item: LibraryItem = { id: "item-one", name: "Arrival", type: "Movie", resumePositionTicks: 0, played: false };
const UNSAFE = "unsafe external subtitle URL";
const PATH = "/Videos/one/source/Subtitles/3/0/Stream.vtt";

async function planWith(serverUrl: string, deliveryUrl: string, standIn: ((url: URL) => string | undefined) | undefined, storedServerUrl?: string) {
  const transport = new FakeTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "top-secret", User: { Id: "user-1", Name: "Louise" } });
  const gateway = new JellyfinGateway(serverUrl, webCrypto, transport, "install-1");
  await gateway.login("Louise", "password");
  // The constructor normalizes the address to ASCII; a stored value that is not plain ASCII is set directly.
  if (storedServerUrl) (gateway as { serverUrl: string }).serverUrl = storedServerUrl;
  transport.responses.set("POST /Items/item-one/PlaybackInfo", {
    PlaySessionId: "play-1",
    MediaSources: [{
      Id: "source-1",
      Path: "/media/movie.mkv",
      Protocol: "File",
      SupportsDirectPlay: true,
      MediaStreams: [{ Index: 3, Type: "Subtitle", IsExternal: true, DeliveryUrl: deliveryUrl }],
    }],
  });
  if (standIn) {
    const report = standIn;
    const Real = URL;
    class StandIn extends Real {
      override get hostname(): string {
        return report(this) ?? super.hostname;
      }
    }
    vi.stubGlobal("URL", StandIn);
  }
  return gateway.createPlaybackPlan(item);
}

afterEach(() => vi.unstubAllGlobals());

describe("T8-22 follow-up: G1 relative test", () => {
  it.each([
    ["a slash then a backslash and a fullwidth host", "/\\ｍedia.test/Videos/x/Stream.vtt"],
    ["a slash, a tab, then a slash", "/\t/ｍedia.test/Videos/x/Stream.vtt"],
    ["a slash, a newline, then a slash", "/\n/media.test/Videos/x/Stream.vtt"],
    ["a slash, a backslash and a percent-encoded dot", "/\\media%2Etest/Videos/x/Stream.vtt"],
  ])("refuses %s as a subtitle URL", async (_name, deliveryUrl) => {
    await expect(planWith("https://media.test/jellyfin/", deliveryUrl, undefined)).rejects.toThrow(UNSAFE);
  });

  it.each(["/\\ｍedia.test/videos/item/master.m3u8", "/\t/ｍedia.test/videos/item/master.m3u8"])(
    "never lets %j reach another host as a master URL",
    (url) => {
      // rebuildMasterUrl joins such a value onto the server URL as a string, so it stays a path on the server.
      const result = rebuildMasterUrl(url, {
        serverUrl: "https://media.test",
        itemId: "item",
        mediaSourceId: "s",
        mediaKind: "videos",
        playSessionId: "p",
      });
      expect(result.ok).toBe(false);
    },
  );
});

describe("T8-22 follow-up: each half of G2 alone", () => {
  it("refuses when the parsed DeliveryUrl host is not plain ASCII", async () => {
    await expect(
      planWith("https://media.test/jellyfin/", PATH, (url) => (url.pathname.includes("/Subtitles/") ? "ｍedia.test" : undefined)),
    ).rejects.toThrow(UNSAFE);
  });

  it("refuses when the parsed server host is not plain ASCII", async () => {
    await expect(
      planWith("https://media.test/jellyfin/", PATH, (url) => (url.pathname.includes("/Subtitles/") ? undefined : "ｍedia.test")),
    ).rejects.toThrow(UNSAFE);
  });

  it("refuses when the stored server URL is not written in plain ASCII", async () => {
    await expect(planWith("https://media.test/jellyfin/", "https://media.test/Videos/one/source/Subtitles/3/0/Stream.vtt", undefined, "https://ｍedia.test/jellyfin")).rejects.toThrow(UNSAFE);
  });
});
