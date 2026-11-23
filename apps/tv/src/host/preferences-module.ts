// The sibling a tvOS build loads (decision 0003): the preferences module is Android-only until the Swift store exists
// (T14, against PreferencesKeeper). The store then reads the defaults and its writes fail silently. The message is
// fixed text.
import type { OctavePreferencesNative } from "@octave/preferences";

export function loadPreferencesModule(): OctavePreferencesNative {
  throw new Error("The preferences module is not available on this platform.");
}
