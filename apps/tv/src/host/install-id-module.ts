// The sibling a tvOS build loads (decision 0003): the install id module is Android-only until the Swift store exists
// (T14, against InstallIdKeeper). The message is fixed text.
import type { OctaveInstallIdNative } from "@octave/install-id";

export function loadInstallIdModule(): OctaveInstallIdNative {
  throw new Error("The install id module is not available on this platform.");
}
