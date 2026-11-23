// The sibling a tvOS build loads (decision 0003): the player module is Android-only until a Swift engine mirrors the
// seam. The message is fixed text.
import type { OctavePlayerNative } from "@octave/player";

export function loadPlayerModule(): OctavePlayerNative {
  throw new Error("The player module is not available on this platform.");
}
