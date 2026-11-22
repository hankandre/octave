// @vitest-environment node
// T8-22 item 4, the gateway's half (docs/specs/T8-22.md, G1 and G2): a server-supplied subtitle URL passes host
// rules R1 and R2 as written, not only the origin comparison, before the gateway builds a plan from it.
import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import type { LibraryItem } from "../domain/catalog";
import { JellyfinGateway } from "./gateway";
import { FakeTransport } from "./fake-transport";

const item: LibraryItem = { id: "item-one", name: "Arrival", type: "Movie", resumePositionTicks: 0, played: false };
const UNSAFE = "unsafe external subtitle URL";
const INVALID = "invalid external subtitle URL";

async function planWith(deliveryUrl: string) {
  const transport = new FakeTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "top-secret", User: { Id: "user-1", Name: "Louise" } });
  const gateway = new JellyfinGateway("https://media.test/jellyfin/", webCrypto, transport, "install-1");
  await gateway.login("Louise", "password");
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
  return gateway.createPlaybackPlan(item);
}

async function messageOf(deliveryUrl: string): Promise<string> {
  try {
    await planWith(deliveryUrl);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("a subtitle URL from the server and the host rules", () => {
  it.each([
    ["a fullwidth host that maps onto the server's", "https://ｍedia.test/Videos/one/source/Subtitles/3/0/Stream.vtt"],
    ["a protocol-relative value", "//media.test/Videos/one/source/Subtitles/3/0/Stream.vtt"],
    ["a value with no leading slash", "Videos/one/source/Subtitles/3/0/Stream.vtt"],
    ["a percent-encoded dot in the host", "https://media%2Etest/Videos/one/source/Subtitles/3/0/Stream.vtt"],
    ["a backslash after the host", "https://media.test\\@other.test/Videos/one/source/Subtitles/3/0/Stream.vtt"],
  ])("T8-22 item 4: rejects %s with the unsafe-subtitle sentence and none of the URL", async (_name, deliveryUrl) => {
    const message = await messageOf(deliveryUrl);
    expect(message).toContain(UNSAFE);
    expect(message).not.toContain(deliveryUrl);
    expect(message).not.toContain("top-secret");
    expect(message).not.toContain("other.test");
  });

  it("T8-22 item 4: still builds a path that starts with one slash", async () => {
    const plan = await planWith("/Videos/one/source/Subtitles/3/0/Stream.vtt");
    expect(plan.tracks[0].deliveryUrl).toBe("https://media.test/Videos/one/source/Subtitles/3/0/Stream.vtt");
  });

  it("T8-22 item 4: still builds an absolute same-origin URL written in plain ASCII", async () => {
    const plan = await planWith("https://media.test/Videos/one/source/Subtitles/3/0/Stream.vtt");
    expect(plan.tracks[0].deliveryUrl).toBe("https://media.test/Videos/one/source/Subtitles/3/0/Stream.vtt");
  });

  it("T8-22 item 4: keeps the invalid-subtitle sentence for a value that does not parse", async () => {
    const message = await messageOf("https://[");
    expect(message).toContain(INVALID);
    expect(message).not.toContain("https://[");
  });
});
