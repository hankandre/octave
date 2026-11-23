// The one place the app loads the native player module (T8-01). Its six functions and its event reach JavaScript only
// through createPlayerEngine (./player-engine.ts), which turns them into the core's PlayerEngine port.
import type { OctavePlayerNative } from "@octave/player";
import { requireNativeModule } from "expo";

export function loadPlayerModule(): OctavePlayerNative {
  return requireNativeModule<OctavePlayerNative>("OctavePlayer");
}
