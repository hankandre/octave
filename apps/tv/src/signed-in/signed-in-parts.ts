// What the signed-in app is built from for one finished sign-in (T4-03 D8). The native loaders are arguments and every
// import is a type, so this loads under Node; host/host-signed-in.ts passes the real ones.
import type { PlayerEngine } from "@octave/core/src/domain/player-engine";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import type { Clock } from "@octave/core/src/ports/clock";
import type { ArtworkComponent } from "../design/rows/artwork";
import type { loadArtworkView } from "../host/artwork-view";
import type { NativeArtworkOptions } from "../host/native-artwork";
import type { PlayerNative } from "../host/player-engine";
import type { loadPlayerView } from "../host/player-view";
import type { SignedIn } from "../sign-in/sign-in-services";
import type { SignedInAppProps } from "./signed-in-app";

export type SignedInLoaders = {
  loadPlayerModule: () => PlayerNative;
  loadPlayerView: typeof loadPlayerView;
  loadArtworkView: typeof loadArtworkView;
  createPlayerEngine: (native: PlayerNative) => PlayerEngine;
  createNativeArtwork: (options: NativeArtworkOptions) => ArtworkComponent;
  clock: Clock;
};

// The artwork view asks for the session each time it draws; the gateway throws once signed out.
function sessionOf(gateway: JellyfinGateway): string | undefined {
  try {
    return gateway.sessionId();
  } catch {
    return undefined;
  }
}

export function createSignedInParts(loaders: SignedInLoaders): (signedIn: SignedIn) => SignedInAppProps {
  return ({ gateway, serverName }) => ({
    gateway,
    serverName,
    engine: loaders.createPlayerEngine(loaders.loadPlayerModule()),
    PlayerView: loaders.loadPlayerView(),
    clock: loaders.clock,
    Artwork: loaders.createNativeArtwork({ view: loaders.loadArtworkView(), session: () => sessionOf(gateway) }),
  });
}
