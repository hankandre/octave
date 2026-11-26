// The wired parts of the signed-in app (T4-03 D8). Device-only, like ./host-gateway.ts: it imports the native loaders.
import { createSignedInParts } from "../signed-in/signed-in-parts";
import { loadArtworkView } from "./artwork-view";
import { hostClock } from "./clock";
import { createNativeArtwork } from "./native-artwork";
import { createPlayerEngine } from "./player-engine";
import { loadPlayerModule } from "./player-module";
import { loadPlayerView } from "./player-view";

export const hostSignedInParts = createSignedInParts({
  loadPlayerModule,
  loadPlayerView,
  loadArtworkView,
  createPlayerEngine,
  createNativeArtwork,
  clock: hostClock,
});
