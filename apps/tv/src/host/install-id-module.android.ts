// The one place the app loads the native install id module (T4-09). Its one function reaches JavaScript only through
// createInstallIdSource (./install-id.ts).
import type { OctaveInstallIdNative } from "@octave/install-id";
import { requireNativeModule } from "expo";

export function loadInstallIdModule(): OctaveInstallIdNative {
  return requireNativeModule<OctaveInstallIdNative>("OctaveInstallId");
}
