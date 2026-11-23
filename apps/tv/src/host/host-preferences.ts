// The wired preference store (T9-02). The store is built on first use, so importing this file loads no native module;
// the store itself is tested under Node from ./preferences.ts. Settings (T9-03) and the player read this one store
// through the core's views (streamingLimitsOf and the rest), and wait for `ready` before offering a device-field change.
import { createDevicePreferenceStore, type DevicePreferenceStore } from "./preferences";
import { loadPreferencesModule } from "./preferences-module";

let store: DevicePreferenceStore | undefined;

export function hostPreferences(): DevicePreferenceStore {
  store ??= createDevicePreferenceStore(loadPreferencesModule);
  return store;
}
