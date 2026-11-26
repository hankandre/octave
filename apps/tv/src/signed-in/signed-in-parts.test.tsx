// T4-03 item 9 (docs/specs/T4-03.md, D8): what the app hands the signed-in app for a finished sign-in.
//
// Testing contract (the implementer builds to it)
// - `createSignedInParts({ loadPlayerModule, loadPlayerView, loadArtworkView, createPlayerEngine, createNativeArtwork,
//   clock })` returns `(signedIn) => SignedInAppProps`. The loaders are arguments, so only host code imports the native ones.
import { describe, expect, it, jest } from "@jest/globals";
import type { ComponentType } from "react";
import { View } from "react-native";
import { createFakePlayerEngine } from "@octave/core/src/player/fake-player-engine";
import { FakeClock } from "@octave/core/src/ports/fake-clock";
import type { ArtworkComponent } from "../design/rows/artwork";
import type { PlayerViewProps } from "../host/player-view";
import type { NativeArtworkOptions } from "../host/native-artwork";
import type { PlayerNative } from "../host/player-engine";
import { LAN, QuickConnectTransport, chooseServer } from "../sign-in/test-support/quick-connect-doubles";
import { createSignedInParts } from "./signed-in-parts";

async function build() {
  const transport = new QuickConnectTransport();
  const chosen = await chooseServer(LAN, transport);
  await chosen.gateway.authenticateWithQuickConnect("0".repeat(64));

  const playerModule = {} as ReturnType<Parameters<typeof createSignedInParts>[0]["loadPlayerModule"]>;
  const playerView = View as ComponentType<PlayerViewProps>;
  const artworkView = (() => null) as unknown as ReturnType<Parameters<typeof createSignedInParts>[0]["loadArtworkView"]>;
  const engine = createFakePlayerEngine().engine;
  const artwork: ArtworkComponent = () => null;
  const clock = new FakeClock(0);
  const loaders = {
    loadPlayerModule: jest.fn(() => playerModule),
    loadPlayerView: jest.fn(() => playerView),
    loadArtworkView: jest.fn(() => artworkView),
    createPlayerEngine: jest.fn((_native: PlayerNative) => engine),
    createNativeArtwork: jest.fn((_options: NativeArtworkOptions) => artwork),
    clock,
  };
  const parts = createSignedInParts(loaders)({ gateway: chosen.gateway, serverName: "Fixture Server" });
  return { parts, loaders, chosen, playerModule, playerView, artworkView, engine, artwork, clock };
}

describe("T4-03 item 9: the parts of the signed-in app", () => {
  it("T4-03 item 9: carry the sign-in's gateway and server name, one engine over the player module, its view, and the app's clock", async () => {
    const rig = await build();

    expect(rig.parts.gateway).toBe(rig.chosen.gateway);
    expect(rig.parts.serverName).toBe("Fixture Server");
    expect(rig.loaders.createPlayerEngine).toHaveBeenCalledTimes(1);
    expect(rig.loaders.createPlayerEngine.mock.calls[0]?.[0]).toBe(rig.playerModule);
    expect(rig.parts.engine).toBe(rig.engine);
    expect(rig.parts.PlayerView).toBe(rig.playerView);
    expect(rig.parts.clock).toBe(rig.clock);
  });

  it("T4-03 item 9: the artwork is the native one over the artwork view", async () => {
    const rig = await build();

    expect(rig.parts.Artwork).toBe(rig.artwork);
    expect(rig.loaders.createNativeArtwork).toHaveBeenCalledTimes(1);
    expect(rig.loaders.createNativeArtwork.mock.calls[0]?.[0].view).toBe(rig.artworkView);
  });

  it("T4-03 item 9: the artwork reads the signed-in session, and none once the gateway has signed out", async () => {
    const rig = await build();
    const session = rig.loaders.createNativeArtwork.mock.calls[0]?.[0].session;

    expect(session?.()).toBe(rig.chosen.gateway.sessionId());

    await rig.chosen.gateway.logout();

    expect(session?.()).toBeUndefined();
  });
});
