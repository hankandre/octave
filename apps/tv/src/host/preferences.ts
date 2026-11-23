// The TV's preference store (T9-02): one PreferenceStore over all the preference fields, whose device fields are kept in
// one versioned record by the native preferences module. Every read is rebuilt through decodeDeviceRecord and every
// write is encodeDeviceRecord output, so only allowlisted, validated fields are stored or read back. The account fields
// are never written to the device: they are at their defaults until useAccount reads them from the active account's
// source (the server's display preferences, T9-09), and an update of one is saved through that source.
// Types only are imported from the module, so Node can load this file; the wired store is hostPreferences in
// ./host-preferences.ts.
import {
  accountPreferencesOf,
  decodeDeviceRecord,
  DEFAULT_PREFERENCES,
  encodeDeviceRecord,
  isDevicePreferenceKey,
  sanitizeAccountPreferences,
  sanitizePreferences,
  type AccountPreferenceKey,
  type AccountPreferenceSource,
  type PreferenceStore,
  type PreferenceValues,
} from "@octave/core/src/preference-store";
import { LimitListeners } from "@octave/core/src/streaming-limits";
import type { OctavePreferencesNative } from "@octave/preferences";

// `ready` settles, never rejecting, once the launch read has landed or failed. A consumer that offers a device-field
// change waits for it: an update made before it makes the launch read ignored (D7).
//
// useAccount(source) makes `source` the active account: the account fields go back to their defaults at once, then the
// source's values are read in (a failed read keeps the defaults); undefined is signed out. saveAccount sets a value and
// saves it through the source; it never rejects and answers whether the account has it.
export type DevicePreferenceStore = PreferenceStore & {
  ready: Promise<void>;
  useAccount(source: AccountPreferenceSource | undefined): Promise<void>;
  saveAccount<K extends AccountPreferenceKey>(key: K, value: PreferenceValues[K]): Promise<"saved" | "failed" | "no-account">;
};

interface ActiveAccount {
  source: AccountPreferenceSource | undefined;
  epoch: number;
  // How many times each field changed on this account since the switch.
  changes: Map<AccountPreferenceKey, number>;
  saving: Promise<unknown>;
}

// `native` is a function so that importing this file loads no native module. A failed read (a rejection, a throw from
// the loader, or text that is not a record) gives the defaults; a failed write keeps the new value in memory for this
// launch. Neither throws to the caller, and nothing is logged.
export function createDevicePreferenceStore(native: () => Pick<OctavePreferencesNative, "read" | "write">): DevicePreferenceStore {
  let values: PreferenceValues = DEFAULT_PREFERENCES;
  let deviceFieldUpdated = false;
  let writing: Promise<unknown> = Promise.resolve();
  const listeners = new LimitListeners();
  let account: ActiveAccount = { source: undefined, epoch: 0, changes: new Map(), saving: Promise.resolve() };

  const sameAccountFields = (a: PreferenceValues, b: PreferenceValues): boolean =>
    JSON.stringify(accountPreferencesOf(a)) === JSON.stringify(accountPreferencesOf(b));

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

  const useAccount = async (source: AccountPreferenceSource | undefined): Promise<void> => {
    const mine: ActiveAccount = { source, epoch: account.epoch + 1, changes: new Map(), saving: Promise.resolve() };
    account = mine;
    const reset = { ...values, ...accountPreferencesOf(DEFAULT_PREFERENCES) };
    const changed = !sameAccountFields(values, reset);
    values = reset;
    if (changed) listeners.notify();
    if (source === undefined) return;
    let read: unknown;
    try {
      read = await source.read();
    } catch {
      return;
    }
    if (account !== mine) return;
    const fresh = sanitizeAccountPreferences(read);
    const next = { ...values };
    for (const key of ["continueWindow", "skipModes", "autoPlay"] as const) {
      if (!mine.changes.has(key)) Object.assign(next, { [key]: fresh[key] });
    }
    if (sameAccountFields(values, next)) return;
    values = next;
    listeners.notify();
  };

  const saveAccount = async <K extends AccountPreferenceKey>(key: K, value: PreferenceValues[K]): Promise<"saved" | "failed" | "no-account"> => {
    const mine = account;
    const previous = values[key];
    values = sanitizePreferences({ ...values, [key]: value });
    listeners.notify();
    const source = mine.source;
    if (source === undefined) return "no-account";
    const count = (mine.changes.get(key) ?? 0) + 1;
    mine.changes.set(key, count);
    const saved = values[key];
    const run = mine.saving.then(() => source.save({ [key]: saved }));
    mine.saving = run.catch(() => undefined);
    try {
      await run;
      return "saved";
    } catch {
      if (account === mine && mine.changes.get(key) === count) {
        values = { ...values, [key]: previous };
        listeners.notify();
      }
      return "failed";
    }
  };

  return {
    ready,
    get: () => values,
    useAccount,
    saveAccount,
    update: (key, value) => {
      if (!isDevicePreferenceKey(key)) {
        void saveAccount(key, value as PreferenceValues[AccountPreferenceKey]);
        return;
      }
      values = sanitizePreferences({ ...values, [key]: value });
      listeners.notify();
      deviceFieldUpdated = true;
      const record = encodeDeviceRecord(values);
      // Each write starts after the previous one settles, so the file ends with the last update.
      writing = writing.then(() => native().write(record)).catch(() => undefined);
    },
    subscribe: (listener) => listeners.add(listener),
  };
}
