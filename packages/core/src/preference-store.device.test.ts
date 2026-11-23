// T9-02 (docs/specs/T9-02.md, "Acceptance" and "Test plan"): the core's side of the one versioned, non-secret
// preferences record. The device record holds the per-device fields only ({ version: 1, streamingLimits }); the
// per-account fields pass the same allowlist (sanitizePreferences) and are kept for the server's display preferences
// (T9-09). Every read and write rebuilds the record from validated fields, so no token, credential, URL or play-session
// id is ever written or read back.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { STREAMING_LIMIT_CHOICES_MBPS } from "./streaming-limits";
import {
  ACCOUNT_PREFERENCE_KEYS,
  accountPreferencesOf,
  decodeDeviceRecord,
  DEFAULT_PREFERENCES,
  DEVICE_PREFERENCE_KEYS,
  encodeDeviceRecord,
  sanitizeAccountPreferences,
  sanitizePreferences,
  storedPreferences,
  type PreferenceValues,
} from "./preference-store";

const DEFAULTS = {
  streamingLimits: {},
  continueWindow: "90",
  skipModes: { intro: "button", credits: "button" },
  autoPlay: { enabled: true, countdownSeconds: 10 },
};

const ACCOUNT_DEFAULTS = {
  continueWindow: "90",
  skipModes: { intro: "button", credits: "button" },
  autoPlay: { enabled: true, countdownSeconds: 10 },
};

// Every limit combination: no limit or one of the offered choices, for each of the two subfields (9 x 9 = 81).
const LIMIT_OPTIONS: (number | undefined)[] = [undefined, ...STREAMING_LIMIT_CHOICES_MBPS];
const ALL_LIMITS = LIMIT_OPTIONS.flatMap((localMbps) =>
  LIMIT_OPTIONS.map((remoteMbps) => ({
    ...(localMbps === undefined ? {} : { localMbps }),
    ...(remoteMbps === undefined ? {} : { remoteMbps }),
  })),
);

const NON_DEFAULT_ACCOUNT = {
  continueWindow: "30",
  skipModes: { intro: "auto", credits: "none" },
  autoPlay: { enabled: false, countdownSeconds: 5 },
} as const;

const SAMPLE_VALUES: PreferenceValues[] = [
  DEFAULT_PREFERENCES,
  { ...DEFAULT_PREFERENCES, streamingLimits: { localMbps: 20 } },
  { ...DEFAULT_PREFERENCES, streamingLimits: { localMbps: 120, remoteMbps: 4 }, ...NON_DEFAULT_ACCOUNT },
  { streamingLimits: { remoteMbps: 8 }, continueWindow: "all", skipModes: { intro: "none", credits: "auto" }, autoPlay: { enabled: true, countdownSeconds: 15 } },
];

const recordText = (fields: Record<string, unknown>) => JSON.stringify(fields);

describe("T9-02 item 1: one versioned record, rebuilt from the allowlist on every read and write", () => {
  it.each(SAMPLE_VALUES.map((values, index) => [index, values] as const))(
    "T9-02 item 1: encodeDeviceRecord of sample %i holds exactly version 1 and streamingLimits",
    (_, values) => {
      const written = JSON.parse(encodeDeviceRecord(values)) as Record<string, unknown>;
      expect(Object.keys(written).sort()).toEqual(["streamingLimits", "version"]);
      expect(written.version).toBe(1);
      expect(written.streamingLimits).toEqual(values.streamingLimits);
    },
  );

  it("T9-02 item 1: storedPreferences is the device record, and encodeDeviceRecord is its JSON text", () => {
    const values = SAMPLE_VALUES[2];
    expect(storedPreferences(values)).toEqual({ version: 1, streamingLimits: { localMbps: 120, remoteMbps: 4 } });
    expect(encodeDeviceRecord(values)).toBe(JSON.stringify(storedPreferences(values)));
  });

  it("T9-02 item 1: the encoder rebuilds through the allowlist, so an invalid limit or an extra key is not written", () => {
    const values = { ...DEFAULT_PREFERENCES, streamingLimits: { localMbps: 7, remoteMbps: 4, extra: 1 }, other: "x" } as unknown as PreferenceValues;
    expect(JSON.parse(encodeDeviceRecord(values))).toEqual({ version: 1, streamingLimits: { remoteMbps: 4 } });
  });

  it.each(SAMPLE_VALUES.map((values, index) => [index, values] as const))(
    "T9-02 item 1: decode of encode of sample %i is its device fields with the account fields at their defaults",
    (_, values) => {
      expect(decodeDeviceRecord(encodeDeviceRecord(values))).toEqual({ ...DEFAULTS, streamingLimits: values.streamingLimits });
    },
  );

  it("T9-02 item 1: every one of the 81 limit combinations survives encode then decode", () => {
    expect(ALL_LIMITS).toHaveLength(81);
    for (const limits of ALL_LIMITS) {
      expect(decodeDeviceRecord(encodeDeviceRecord({ ...DEFAULT_PREFERENCES, streamingLimits: limits }))).toEqual({ ...DEFAULTS, streamingLimits: limits });
    }
  });

  it.each([
    ["version 0", recordText({ version: 0, streamingLimits: { localMbps: 20 } })],
    ["version 2", recordText({ version: 2, streamingLimits: { localMbps: 20 } })],
    ['version "1"', recordText({ version: "1", streamingLimits: { localMbps: 20 } })],
    ["no version", recordText({ streamingLimits: { localMbps: 20 } })],
  ])("T9-02 item 1: a record at %s reads as the defaults", (_, text) => {
    expect(decodeDeviceRecord(text)).toEqual(DEFAULTS);
  });

  it.each([
    ["text that is not JSON", "not json"],
    ["a cut-off record", '{"version":1,"streamingLimits":{"localMbps":20'],
    ["JSON null", "null"],
    ["a JSON number", "5"],
    ["a JSON string", '"text"'],
    ["a JSON array", '[1,{"version":1}]'],
    ["empty text", ""],
  ])("T9-02 item 1: %s reads as the defaults", (_, text) => {
    expect(decodeDeviceRecord(text)).toEqual(DEFAULTS);
  });

  it.each([[null], [undefined], [5], [{ version: 1, streamingLimits: { localMbps: 20 } }]])(
    "T9-02 item 1: a non-string answer %j reads as the defaults",
    (answer) => {
      expect(decodeDeviceRecord(answer)).toEqual(DEFAULTS);
    },
  );
});

describe("T9-02 item 2: a field outside the allowlist, or with an invalid value, is dropped for its default", () => {
  it("T9-02 item 2: a stored record drops an extra top-level key and keeps the good fields", () => {
    const text = recordText({ version: 1, streamingLimits: { localMbps: 20 }, extra: "x" });
    expect(decodeDeviceRecord(text)).toEqual({ ...DEFAULTS, streamingLimits: { localMbps: 20 } });
    expect(JSON.stringify(decodeDeviceRecord(text))).not.toContain("extra");
  });

  it("T9-02 item 2: an unknown key inside streamingLimits is dropped and the known one kept", () => {
    const text = recordText({ version: 1, streamingLimits: { remoteMbps: 4, maxMbps: 40 } });
    expect(decodeDeviceRecord(text)).toEqual({ ...DEFAULTS, streamingLimits: { remoteMbps: 4 } });
  });

  it("T9-02 item 2: a limit that is not an offered choice falls back to No limit and the other limit is kept", () => {
    const text = recordText({ version: 1, streamingLimits: { localMbps: 7, remoteMbps: 10 } });
    expect(decodeDeviceRecord(text)).toEqual({ ...DEFAULTS, streamingLimits: { remoteMbps: 10 } });
  });

  it.each([["x"], [5], [null], [[20]], [true]])("T9-02 item 2: streamingLimits %j reads as No limit", (limits) => {
    expect(decodeDeviceRecord(recordText({ version: 1, streamingLimits: limits }))).toEqual(DEFAULTS);
  });

  it("T9-02 item 2: sanitizeAccountPreferences drops unknown keys and maps invalid values to their defaults", () => {
    const bad = { continueWindow: "7", skipModes: { intro: "AUTO" }, autoPlay: { countdownSeconds: 7 }, extra: 1, streamingLimits: { localMbps: 20 } };
    expect(sanitizeAccountPreferences(bad)).toEqual(ACCOUNT_DEFAULTS);
  });

  it("T9-02 item 2: sanitizeAccountPreferences keeps each good field while another is bad", () => {
    expect(sanitizeAccountPreferences({ continueWindow: "180", skipModes: 7, autoPlay: { enabled: false, countdownSeconds: 7 } })).toEqual({
      continueWindow: "180",
      skipModes: { intro: "button", credits: "button" },
      autoPlay: { enabled: false, countdownSeconds: 10 },
    });
  });

  it.each([[null], [undefined], [5], ["x"], [[]]])("T9-02 item 2: sanitizeAccountPreferences of %j is the account defaults", (input) => {
    expect(sanitizeAccountPreferences(input)).toEqual(ACCOUNT_DEFAULTS);
  });
});

describe("T9-02 item 3: the device record holds the per-device fields; the per-account fields pass the same allowlist", () => {
  it("T9-02 item 3: the device and account key lists are disjoint and together are every preference field", () => {
    const device = [...DEVICE_PREFERENCE_KEYS];
    const account = [...ACCOUNT_PREFERENCE_KEYS];
    expect(device.filter((key) => (account as string[]).includes(key))).toEqual([]);
    expect([...device, ...account].sort()).toEqual(Object.keys(DEFAULT_PREFERENCES).sort());
  });

  it("T9-02 item 3: the device keys are exactly streamingLimits", () => {
    expect([...DEVICE_PREFERENCE_KEYS]).toEqual(["streamingLimits"]);
    expect([...ACCOUNT_PREFERENCE_KEYS].sort()).toEqual(["autoPlay", "continueWindow", "skipModes"]);
  });

  it("T9-02 item 3: a stored record holding valid non-default account fields reads them as their defaults", () => {
    const text = recordText({ version: 1, streamingLimits: { localMbps: 40 }, ...NON_DEFAULT_ACCOUNT });
    expect(decodeDeviceRecord(text)).toEqual({ ...DEFAULTS, streamingLimits: { localMbps: 40 } });
  });

  it("T9-02 item 3: non-default account fields are not written to the device record", () => {
    const text = encodeDeviceRecord({ ...DEFAULT_PREFERENCES, streamingLimits: { localMbps: 40 }, ...NON_DEFAULT_ACCOUNT });
    expect(JSON.parse(text)).toEqual({ version: 1, streamingLimits: { localMbps: 40 } });
    for (const key of ["continueWindow", "skipModes", "autoPlay"]) expect(text).not.toContain(key);
  });

  const accountInputs: unknown[] = [
    null,
    5,
    {},
    NON_DEFAULT_ACCOUNT,
    { ...NON_DEFAULT_ACCOUNT, streamingLimits: { localMbps: 20 }, extra: true },
    { continueWindow: "7", skipModes: { intro: "AUTO", credits: "auto" }, autoPlay: { enabled: "no", countdownSeconds: 15 } },
    { continueWindow: 90, skipModes: "auto", autoPlay: null },
  ];

  it.each(accountInputs.map((input) => [input]))(
    "T9-02 item 3: sanitizeAccountPreferences(%j) is the account fields of sanitizePreferences and has no streamingLimits",
    (input) => {
      const full = sanitizePreferences(input);
      const account = sanitizeAccountPreferences(input) as Record<string, unknown>;
      expect(account).toEqual({ continueWindow: full.continueWindow, skipModes: full.skipModes, autoPlay: full.autoPlay });
      expect("streamingLimits" in account).toBe(false);
    },
  );

  it("T9-02 item 3: accountPreferencesOf gives the account fields of a values object and no device field", () => {
    const values: PreferenceValues = { ...DEFAULT_PREFERENCES, streamingLimits: { localMbps: 40 }, ...NON_DEFAULT_ACCOUNT };
    const account = accountPreferencesOf(values) as Record<string, unknown>;
    expect(account).toEqual(NON_DEFAULT_ACCOUNT);
    expect("streamingLimits" in account).toBe(false);
  });
});

// Visibly fake secrets (docs/specs/T9-02.md, "Test plan").
const TOKEN = "0123456789abcdef0123456789abcdef";
const SECRETS: Record<string, string> = {
  token: TOKEN,
  authorization: `MediaBrowser Client="Octave", Device="Android TV", DeviceId="octave-test-device", Version="0.0.0", Token="${TOKEN}"`,
  url: `https://media.example.test/Videos/x/stream?api_key=${TOKEN}`,
  playSessionId: "5f0e1d2c3b4a59687766554433221100",
  password: "correct horse battery staple",
  tokenSha256: createHash("sha256").update(TOKEN).digest("hex"),
};

// Each place a value can sit in a record: a top-level key or value, a key or value inside each object field, and the
// value of every known subfield.
function placements(secret: string): Record<string, unknown>[] {
  return [
    { [secret]: secret },
    { [secret]: 1 },
    { streamingLimits: secret },
    { continueWindow: secret },
    { skipModes: secret },
    { autoPlay: secret },
    { streamingLimits: { [secret]: secret, localMbps: 20 } },
    { skipModes: { [secret]: secret, intro: "auto" } },
    { autoPlay: { [secret]: secret, enabled: false } },
    { streamingLimits: { localMbps: secret, remoteMbps: secret } },
    { skipModes: { intro: secret, credits: secret } },
    { autoPlay: { enabled: secret, countdownSeconds: secret } },
  ];
}

// The secret as written, percent-encoded, and as it appears inside a JSON string.
const forms = (secret: string) => [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)];

function expectNone(text: string, secret: string) {
  for (const form of forms(secret)) expect(text).not.toContain(form);
  expect(text).not.toContain(TOKEN);
}

describe("T9-02 item 4: the record never holds a token, credential, URL or play-session id", () => {
  it.each(Object.entries(SECRETS))("T9-02 item 4: the %s written in every place is not in the written record", (_, secret) => {
    for (const placed of placements(secret)) {
      expectNone(encodeDeviceRecord(sanitizePreferences(placed)), secret);
      expectNone(encodeDeviceRecord(placed as unknown as PreferenceValues), secret);
    }
  });

  it.each(Object.entries(SECRETS))("T9-02 item 4: the %s in every place of a stored record is not read back", (_, secret) => {
    for (const placed of placements(secret)) {
      expectNone(JSON.stringify(decodeDeviceRecord(recordText({ version: 1, ...placed }))), secret);
    }
  });

  it.each(Object.entries(SECRETS))("T9-02 item 4: the %s is not kept in the account fields either", (_, secret) => {
    for (const placed of placements(secret)) {
      expectNone(JSON.stringify(sanitizeAccountPreferences(placed)), secret);
    }
  });
});

describe("T9-02 item 5: the defaults", () => {
  it("T9-02 item 5: auto-play on, countdown 10 s, Show a Skip button for intros and credits, No limit, 90 days", () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      streamingLimits: {},
      continueWindow: "90",
      skipModes: { intro: "button", credits: "button" },
      autoPlay: { enabled: true, countdownSeconds: 10 },
    });
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true);
  });

  it("T9-02 item 5: an absent device record decodes to the defaults", () => {
    expect(decodeDeviceRecord(null)).toEqual(DEFAULT_PREFERENCES);
  });
});
