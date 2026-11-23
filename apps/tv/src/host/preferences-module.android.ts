// The one place the app loads the native preferences module (T9-02). Its two functions reach JavaScript only through
// createDevicePreferenceStore (./preferences.ts).
import type { OctavePreferencesNative } from "@octave/preferences";
import { requireNativeModule } from "expo";

export function loadPreferencesModule(): OctavePreferencesNative {
  return requireNativeModule<OctavePreferencesNative>("OctavePreferences");
}
