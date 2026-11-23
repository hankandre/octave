// The TV's preference store (T9-02): one PreferenceStore over all the preference fields, whose device fields are kept in
// one versioned record by the native preferences module. Every read is rebuilt through decodeDeviceRecord and every
// write is encodeDeviceRecord output, so only allowlisted, validated fields are stored or read back. The account fields
// live in memory, at their defaults each launch, until T9-09 stores them on the server's display preferences.
// Types only are imported from the module, so Node can load this file; the wired store is hostPreferences in
// ./host-preferences.ts.
import {
  accountPreferencesOf,
  decodeDeviceRecord,
  DEFAULT_PREFERENCES,
  encodeDeviceRecord,
  isDevicePreferenceKey,
  sanitizePreferences,
  type PreferenceStore,
  type PreferenceValues,
} from "@octave/core/src/preference-store";
import { LimitListeners } from "@octave/core/src/streaming-limits";
import type { OctavePreferencesNative } from "@octave/preferences";

// `ready` settles, never rejecting, once the launch read has landed or failed. A consumer that offers a device-field
// change waits for it: an update made before it makes the launch read ignored (D7).
export type DevicePreferenceStore = PreferenceStore & { ready: Promise<void> };

// `native` is a function so that importing this file loads no native module. A failed read (a rejection, a throw from
// the loader, or text that is not a record) gives the defaults; a failed write keeps the new value in memory for this
// launch. Neither throws to the caller, and nothing is logged.
export function createDevicePreferenceStore(native: () => Pick<OctavePreferencesNative, "read" | "write">): DevicePreferenceStore {
  let values: PreferenceValues = DEFAULT_PREFERENCES;
  let deviceFieldUpdated = false;
  let writing: Promise<unknown> = Promise.resolve();
  const listeners = new LimitListeners();

  const readStored = async (): Promise<void> => {
    let answer: unknown;
    try {
      answer = await native().read();
    } catch {
      return;
    }
    // A newer choice made on this launch wins over the stored record.
    if (deviceFieldUpdated) return;
    const next = { ...decodeDeviceRecord(answer), ...accountPreferencesOf(values) };
    if (encodeDeviceRecord(next) === encodeDeviceRecord(values)) return;
    values = next;
    listeners.notify();
  };

  const ready = readStored();

  return {
    ready,
    get: () => values,
    update: (key, value) => {
      values = sanitizePreferences({ ...values, [key]: value });
      listeners.notify();
      if (!isDevicePreferenceKey(key)) return;
      deviceFieldUpdated = true;
      const record = encodeDeviceRecord(values);
      // Each write starts after the previous one settles, so the file ends with the last update.
      writing = writing.then(() => native().write(record)).catch(() => undefined);
    },
    subscribe: (listener) => listeners.add(listener),
  };
}
