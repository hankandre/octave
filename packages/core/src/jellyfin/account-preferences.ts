// The account's settings on the server's display preferences (T9-09): one Octave-owned record, one string per setting.
// Pure mapping: no HTTP, no platform. Values read pass T9-02's allowlist; a save body is built from constants,
// sanitized values and a narrow set of kept keys, never echoed from the read.
import { accountPreferencesOf, DEFAULT_PREFERENCES, sanitizeAccountPreferences, type AccountPreferences } from "../preference-store";
import type { DisplayPreferencesDto } from "./types";

export const ACCOUNT_PREFERENCES_RECORD = Object.freeze({ id: "octave", client: "octave" });

// One row per key, in the order they are written.
export const OCTAVE_PREFERENCE_KEYS = Object.freeze({
  continueWindow: "octave.continueWindow",
  autoPlay: "octave.autoPlay",
  autoPlayCountdown: "octave.autoPlayCountdown",
  skipIntro: "octave.skipIntro",
  skipCredits: "octave.skipCredits",
} as const);

const KEPT_KEY = /^octave\.[A-Za-z][A-Za-z0-9]{0,31}$/;
const KEPT_VALUE = /^[A-Za-z0-9]{1,16}$/;

// A read of the record that holds no usable CustomPrefs. Nothing is posted after it.
export class AccountPreferencesUnreadable extends Error {}

export function customPrefsOf(dto: unknown): Record<string, unknown> | undefined {
  if (typeof dto !== "object" || dto === null || Array.isArray(dto)) return undefined;
  const prefs = (dto as { CustomPrefs?: unknown }).CustomPrefs;
  if (typeof prefs !== "object" || prefs === null || Array.isArray(prefs)) return undefined;
  return prefs as Record<string, unknown>;
}

function textOf(prefs: Record<string, unknown>, key: string): string | undefined {
  const value = Object.hasOwn(prefs, key) ? prefs[key] : undefined;
  return typeof value === "string" ? value : undefined;
}

export function toAccountPreferences(dto: unknown): AccountPreferences {
  const prefs = customPrefsOf(dto);
  if (prefs === undefined) return accountPreferencesOf(DEFAULT_PREFERENCES);
  const enabled = textOf(prefs, OCTAVE_PREFERENCE_KEYS.autoPlay);
  const countdown = textOf(prefs, OCTAVE_PREFERENCE_KEYS.autoPlayCountdown);
  return sanitizeAccountPreferences({
    continueWindow: textOf(prefs, OCTAVE_PREFERENCE_KEYS.continueWindow),
    skipModes: { intro: textOf(prefs, OCTAVE_PREFERENCE_KEYS.skipIntro), credits: textOf(prefs, OCTAVE_PREFERENCE_KEYS.skipCredits) },
    autoPlay: { enabled: enabled === "true" ? true : enabled === "false" ? false : undefined, countdownSeconds: countdown === undefined ? undefined : Number(countdown) },
  });
}

// Keys of a newer Octave build survive a save from an older one, if they cannot hold a URL, token or session id.
export function keptOctaveKeys(dto: unknown): Record<string, string> {
  const prefs = customPrefsOf(dto);
  const kept: Record<string, string> = {};
  if (prefs === undefined) return kept;
  const own = new Set<string>(Object.values(OCTAVE_PREFERENCE_KEYS));
  for (const [key, value] of Object.entries(prefs)) {
    if (own.has(key) || !KEPT_KEY.test(key)) continue;
    if (typeof value === "string" && KEPT_VALUE.test(value)) kept[key] = value;
  }
  return kept;
}

export function displayPreferencesBody(values: AccountPreferences, kept: Record<string, string>): DisplayPreferencesDto {
  const safe = sanitizeAccountPreferences(values);
  return {
    Id: ACCOUNT_PREFERENCES_RECORD.id,
    Client: ACCOUNT_PREFERENCES_RECORD.client,
    SortBy: "SortName",
    SortOrder: "Ascending",
    RememberIndexing: false,
    RememberSorting: false,
    ScrollDirection: "Horizontal",
    ShowBackdrop: true,
    ShowSidebar: false,
    PrimaryImageHeight: 250,
    PrimaryImageWidth: 250,
    CustomPrefs: {
      ...kept,
      [OCTAVE_PREFERENCE_KEYS.continueWindow]: safe.continueWindow,
      [OCTAVE_PREFERENCE_KEYS.autoPlay]: String(safe.autoPlay.enabled),
      [OCTAVE_PREFERENCE_KEYS.autoPlayCountdown]: String(safe.autoPlay.countdownSeconds),
      [OCTAVE_PREFERENCE_KEYS.skipIntro]: safe.skipModes.intro,
      [OCTAVE_PREFERENCE_KEYS.skipCredits]: safe.skipModes.credits,
    },
  };
}

export function withAccountChange(values: AccountPreferences, change: Partial<AccountPreferences>): AccountPreferences {
  return sanitizeAccountPreferences({ ...values, ...change });
}

export interface AccountPreferenceGateway {
  accountPreferences(signal?: AbortSignal): Promise<AccountPreferences>;
  saveAccountPreferences(change: Partial<AccountPreferences>): Promise<AccountPreferences>;
}

export function accountPreferenceSourceOf(gateway: AccountPreferenceGateway) {
  return {
    read: () => gateway.accountPreferences(),
    save: (change: Partial<AccountPreferences>) => gateway.saveAccountPreferences(change),
  };
}
