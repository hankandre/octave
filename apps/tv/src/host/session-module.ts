// The sibling a tvOS build loads (decision 0003): the session module is Android-only until the Swift transport exists.
// The message is fixed text.
import type { OctaveSessionNative } from "@octave/session";

export function loadSessionModule(): OctaveSessionNative {
  throw new Error("The session module is not available on this platform.");
}
