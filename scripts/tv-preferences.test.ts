// @vitest-environment node
// T9-02 items 1 to 5 (docs/specs/T9-02.md, "Acceptance" and "Test plan"): the TV keeps one versioned, non-secret
// preferences record through the native module modules/preferences, and every read and write is rebuilt from the
// core's allowlist.
//
// - apps/tv/src/host/preferences.ts: createDevicePreferenceStore(native) gives a PreferenceStore with `ready`. It starts
//   at DEFAULT_PREFERENCES, reads once through native().read() and decodeDeviceRecord (a read that lands after a
//   device-field update is ignored), and on each update of a device field (streamingLimits) writes
//   encodeDeviceRecord(values) through native().write(), each write chained after the previous one. An update of an
//   account field (autoPlay, skipModes, continueWindow) is kept in memory and writes nothing (T9-09 stores those).
//   Failures never throw to the caller and fall back to the defaults.
// - packages/core/src/preference-store.ts: encodeDeviceRecord, decodeDeviceRecord, DEVICE_PREFERENCE_KEYS,
//   ACCOUNT_PREFERENCE_KEYS, sanitizeAccountPreferences (the core's own tests are preference-store.device.test.ts; this
//   file repeats the assertions the red gate must see for each item).
// - modules/preferences: two functions, read() and write(record). Its TypeScript declares only those; its Expo module
//   defines only those. The module's own JVM tests (PreferencesStoreTest, ModuleSurfaceTest) are the implementer's.
//
// Modules this task creates or extends are loaded at run time from a path built here, so `pnpm typecheck` does not
// depend on them existing (as scripts/tv-install-id.test.ts does).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type Values = {
  streamingLimits: { localMbps?: number; remoteMbps?: number };
  continueWindow: string;
  skipModes: { intro: string; credits: string };
  autoPlay: { enabled: boolean; countdownSeconds: number };
};
type Key = keyof Values;

type Native = { read: () => Promise<string | null>; write: (record: string) => Promise<boolean> };
type DeviceStore = {
  get(): Values;
  update(key: Key, value: unknown): void;
  subscribe(listener: () => void): () => void;
  ready: Promise<void>;
};
type StoreModule = { createDevicePreferenceStore: (native: () => Native) => DeviceStore };
type CoreModule = {
  DEFAULT_PREFERENCES: Values;
  DEVICE_PREFERENCE_KEYS: readonly string[];
  ACCOUNT_PREFERENCE_KEYS: readonly string[];
  encodeDeviceRecord: (values: unknown) => string;
  decodeDeviceRecord: (text: unknown) => Values;
  sanitizePreferences: (value: unknown) => Values;
  sanitizeAccountPreferences: (value: unknown) => Record<string, unknown>;
};

async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(join(repo, path)).href)) as T;
}

const loadStore = async () => (await load<StoreModule>("apps/tv/src/host/preferences.ts")).createDevicePreferenceStore;
const loadCore = () => load<CoreModule>("packages/core/src/preference-store.ts");

const DEFAULTS: Values = {
  streamingLimits: {},
  continueWindow: "90",
  skipModes: { intro: "button", credits: "button" },
  autoPlay: { enabled: true, countdownSeconds: 10 },
};

const NON_DEFAULT_ACCOUNT = {
  continueWindow: "30",
  skipModes: { intro: "auto", credits: "none" },
  autoPlay: { enabled: false, countdownSeconds: 5 },
};

const recordText = (fields: Record<string, unknown>) => JSON.stringify(fields);

// Lets every pending promise callback and chained write run.
async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// A promise resolved or rejected by hand.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A fake native module. `read` answers `answer` (or a pending promise the test settles); `write` answers true unless
// the test holds writes to settle them by hand.
function fakeNative(answer: string | null | Promise<string | null> = null, options: { holdWrites?: boolean } = {}) {
  const pendingWrites: { resolve: (ok: boolean) => void }[] = [];
  const read = vi.fn(() => (answer instanceof Promise ? answer : Promise.resolve(answer)));
  const write = vi.fn((record: string) => {
    void record;
    if (!options.holdWrites) return Promise.resolve(true);
    const held = deferred<boolean>();
    pendingWrites.push({ resolve: held.resolve });
    return held.promise;
  });
  const native = vi.fn(() => ({ read, write }));
  const written = () => write.mock.calls.map(([record]) => record);
  return { native, read, write, written, pendingWrites };
}

async function settled(store: DeviceStore) {
  await store.ready.catch(() => undefined);
  await flush();
}

const parsed = (text: string) => JSON.parse(text) as Record<string, unknown>;

// --- item 1 -----------------------------------------------------------------------------------------------------------

describe("T9-02 item 1: one versioned record, rebuilt from the allowlist on every read and write", () => {
  it("T9-02 item 1: the core encodes exactly { version: 1, streamingLimits } and decodes a bad version or bad text as the defaults", async () => {
    const { encodeDeviceRecord, decodeDeviceRecord } = await loadCore();
    const values = { ...DEFAULTS, streamingLimits: { localMbps: 20, remoteMbps: 4 }, ...NON_DEFAULT_ACCOUNT };
    expect(parsed(encodeDeviceRecord(values))).toEqual({ version: 1, streamingLimits: { localMbps: 20, remoteMbps: 4 } });
    expect(decodeDeviceRecord(encodeDeviceRecord(values))).toEqual({ ...DEFAULTS, streamingLimits: { localMbps: 20, remoteMbps: 4 } });
    for (const version of [0, 2, "1", undefined]) {
      expect(decodeDeviceRecord(recordText({ version, streamingLimits: { localMbps: 20 } }))).toEqual(DEFAULTS);
    }
    for (const text of ["not json", "null", "5", "[]", "", null, undefined]) expect(decodeDeviceRecord(text)).toEqual(DEFAULTS);
  });

  it("T9-02 item 1: after ready, get() is the decoded stored record", async () => {
    const createDevicePreferenceStore = await loadStore();
    const { decodeDeviceRecord } = await loadCore();
    const answer = recordText({ version: 1, streamingLimits: { localMbps: 20, remoteMbps: 4 } });
    const { native, read } = fakeNative(answer);
    const store = createDevicePreferenceStore(native);
    await settled(store);
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual(decodeDeviceRecord(answer));
    expect(store.get()).toEqual({ ...DEFAULTS, streamingLimits: { localMbps: 20, remoteMbps: 4 } });
  });

  it("T9-02 item 1: a read that changes the values notifies, and the listener sees the new values", async () => {
    const createDevicePreferenceStore = await loadStore();
    const reading = deferred<string | null>();
    const { native } = fakeNative(reading.promise);
    const store = createDevicePreferenceStore(native);
    const seen: unknown[] = [];
    store.subscribe(() => seen.push(store.get().streamingLimits));
    reading.resolve(recordText({ version: 1, streamingLimits: { localMbps: 40 } }));
    await settled(store);
    expect(seen.at(-1)).toEqual({ localMbps: 40 });
  });

  it("T9-02 item 1: each update of streamingLimits writes once, and the text is encodeDeviceRecord of get()", async () => {
    const createDevicePreferenceStore = await loadStore();
    const { encodeDeviceRecord } = await loadCore();
    const { native, write, written } = fakeNative(null);
    const store = createDevicePreferenceStore(native);
    await settled(store);
    expect(write).not.toHaveBeenCalled();

    store.update("streamingLimits", { localMbps: 40 });
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(written()[0]).toBe(encodeDeviceRecord(store.get()));
    expect(parsed(written()[0])).toEqual({ version: 1, streamingLimits: { localMbps: 40 } });

    store.update("streamingLimits", { localMbps: 40, remoteMbps: 8 });
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(written()[1]).toBe(encodeDeviceRecord(store.get()));
    expect(parsed(written()[1])).toEqual({ version: 1, streamingLimits: { localMbps: 40, remoteMbps: 8 } });
  });

  it("T9-02 item 1: three quick updates write in order, each after the previous write finishes, and the last write is the last value", async () => {
    const createDevicePreferenceStore = await loadStore();
    const { encodeDeviceRecord } = await loadCore();
    const { native, write, written, pendingWrites } = fakeNative(null, { holdWrites: true });
    const store = createDevicePreferenceStore(native);
    await settled(store);

    const choices = [{ localMbps: 120 }, { localMbps: 80 }, { localMbps: 10, remoteMbps: 2 }];
    for (const limits of choices) store.update("streamingLimits", limits);
    await flush();
    expect(store.get().streamingLimits).toEqual({ localMbps: 10, remoteMbps: 2 });
    expect(write).toHaveBeenCalledTimes(1);

    for (let n = 1; n < choices.length; n += 1) {
      pendingWrites[n - 1].resolve(true);
      await flush();
      expect(write).toHaveBeenCalledTimes(n + 1);
    }
    pendingWrites[choices.length - 1].resolve(true);
    await flush();

    expect(written().map((text) => parsed(text).streamingLimits)).toEqual(choices);
    expect(written().at(-1)).toBe(encodeDeviceRecord(store.get()));
  });

  it("T9-02 item 1: a launch read that lands after a streamingLimits update does not replace the updated limits", async () => {
    const createDevicePreferenceStore = await loadStore();
    const reading = deferred<string | null>();
    const { native, written } = fakeNative(reading.promise);
    const store = createDevicePreferenceStore(native);
    store.update("streamingLimits", { localMbps: 8 });
    reading.resolve(recordText({ version: 1, streamingLimits: { localMbps: 20, remoteMbps: 4 } }));
    await settled(store);
    expect(store.get().streamingLimits.localMbps).toBe(8);
    expect(written().length).toBeGreaterThan(0);
    expect((parsed(written().at(-1) as string).streamingLimits as { localMbps?: number }).localMbps).toBe(8);
  });
});

// --- item 2 -----------------------------------------------------------------------------------------------------------

describe("T9-02 item 2: a field outside the allowlist, or with an invalid value, is dropped for its default", () => {
  it("T9-02 item 2: the core drops unknown keys and invalid values on decode and in the account allowlist", async () => {
    const { decodeDeviceRecord, sanitizeAccountPreferences } = await loadCore();
    const text = recordText({ version: 1, streamingLimits: { localMbps: 7, remoteMbps: 4, maxMbps: 40 }, extra: "x" });
    expect(decodeDeviceRecord(text)).toEqual({ ...DEFAULTS, streamingLimits: { remoteMbps: 4 } });
    expect(decodeDeviceRecord(recordText({ version: 1, streamingLimits: "x" }))).toEqual(DEFAULTS);
    expect(sanitizeAccountPreferences({ continueWindow: "7", skipModes: { intro: "AUTO" }, autoPlay: { countdownSeconds: 7 }, extra: 1 })).toEqual({
      continueWindow: "90",
      skipModes: { intro: "button", credits: "button" },
      autoPlay: { enabled: true, countdownSeconds: 10 },
    });
  });

  it("T9-02 item 2: a stored record with an extra key, an unknown limit key and an invalid limit reads its good parts and defaults for the rest", async () => {
    const createDevicePreferenceStore = await loadStore();
    const answer = recordText({ version: 1, streamingLimits: { localMbps: 7, remoteMbps: 4, maxMbps: 40 }, extra: "x" });
    const { native } = fakeNative(answer);
    const store = createDevicePreferenceStore(native);
    await settled(store);
    expect(store.get()).toEqual({ ...DEFAULTS, streamingLimits: { remoteMbps: 4 } });
  });

  it('T9-02 item 2: a stored streamingLimits of "x" reads as No limit', async () => {
    const createDevicePreferenceStore = await loadStore();
    const { native } = fakeNative(recordText({ version: 1, streamingLimits: "x" }));
    const store = createDevicePreferenceStore(native);
    await settled(store);
    expect(store.get()).toEqual(DEFAULTS);
  });

  it("T9-02 item 2: the next device write after such a read holds none of the dropped keys or values", async () => {
    const createDevicePreferenceStore = await loadStore();
    const answer = recordText({ version: 1, streamingLimits: { localMbps: 7, remoteMbps: 4, maxMbps: 40 }, extra: "x" });
    const { native, written } = fakeNative(answer);
    const store = createDevicePreferenceStore(native);
    await settled(store);
    store.update("streamingLimits", { ...store.get().streamingLimits, localMbps: 20 });
    await flush();
    expect(written()).toHaveLength(1);
    expect(parsed(written()[0])).toEqual({ version: 1, streamingLimits: { localMbps: 20, remoteMbps: 4 } });
    for (const dropped of ["extra", "maxMbps", ":7", ":40"]) expect(written()[0]).not.toContain(dropped);
  });

  it("T9-02 item 2: an update with an invalid value or an unknown key keeps the default for the bad parts and writes none of them",async () => {
    const createDevicePreferenceStore = await loadStore();
    const { native, written } = fakeNative(null);
    const store = createDevicePreferenceStore(native);
    await settled(store);
    store.update("streamingLimits", { localMbps: 7, remoteMbps: 4, maxMbps: 40 });
    store.update("autoPlay", { countdownSeconds: 7 });
    store.update("skipModes", { intro: "AUTO" });
    store.update("continueWindow", "7");
    store.update("bitrate" as Key, 40);
    await flush();
    expect(store.get()).toEqual({ ...DEFAULTS, streamingLimits: { remoteMbps: 4 } });
    expect("bitrate" in store.get()).toBe(false);
    for (const text of written()) {
      expect(Object.keys(parsed(text)).sort()).toEqual(["streamingLimits", "version"]);
      for (const dropped of ["maxMbps", "bitrate", ":7", ":40"]) expect(text).not.toContain(dropped);
    }
    expect(parsed(written().at(-1) as string)).toEqual({ version: 1, streamingLimits: { remoteMbps: 4 } });
  });
});

// --- item 3 -----------------------------------------------------------------------------------------------------------

describe("T9-02 item 3: the device record holds the per-device fields; the account fields pass the same allowlist", () => {
  it("T9-02 item 3: the core splits the allowlist into the device key streamingLimits and the account keys", async () => {
    const { DEVICE_PREFERENCE_KEYS, ACCOUNT_PREFERENCE_KEYS, DEFAULT_PREFERENCES, sanitizePreferences, sanitizeAccountPreferences } = await loadCore();
    expect([...DEVICE_PREFERENCE_KEYS]).toEqual(["streamingLimits"]);
    expect([...ACCOUNT_PREFERENCE_KEYS].sort()).toEqual(["autoPlay", "continueWindow", "skipModes"]);
    expect([...DEVICE_PREFERENCE_KEYS, ...ACCOUNT_PREFERENCE_KEYS].sort()).toEqual(Object.keys(DEFAULT_PREFERENCES).sort());
    for (const input of [null, {}, NON_DEFAULT_ACCOUNT, { ...NON_DEFAULT_ACCOUNT, streamingLimits: { localMbps: 20 } }, { continueWindow: "7", autoPlay: "x" }]) {
      const full = sanitizePreferences(input);
      const account = sanitizeAccountPreferences(input);
      expect(account).toEqual({ continueWindow: full.continueWindow, skipModes: full.skipModes, autoPlay: full.autoPlay });
      expect("streamingLimits" in account).toBe(false);
    }
  });

  it("T9-02 item 3: a stored record holding valid non-default account fields reads them as their defaults", async () => {
    const createDevicePreferenceStore = await loadStore();
    const { native } = fakeNative(recordText({ version: 1, streamingLimits: { localMbps: 40 }, ...NON_DEFAULT_ACCOUNT }));
    const store = createDevicePreferenceStore(native);
    await settled(store);
    expect(store.get()).toEqual({ ...DEFAULTS, streamingLimits: { localMbps: 40 } });
  });

  it("T9-02 item 3: updates of autoPlay, skipModes and continueWindow change get() and write nothing", async () => {
    const createDevicePreferenceStore = await loadStore();
    const { native, write } = fakeNative(null);
    const store = createDevicePreferenceStore(native);
    await settled(store);
    const seen: unknown[] = [];
    store.subscribe(() => seen.push(store.get()));
    store.update("autoPlay", NON_DEFAULT_ACCOUNT.autoPlay);
    store.update("skipModes", NON_DEFAULT_ACCOUNT.skipModes);
    store.update("continueWindow", NON_DEFAULT_ACCOUNT.continueWindow);
    await flush();
    expect(store.get()).toEqual({ ...DEFAULTS, ...NON_DEFAULT_ACCOUNT });
    expect(seen).toHaveLength(3);
    expect(write).toHaveBeenCalledTimes(0);
  });

  it("T9-02 item 3: a device write after account updates holds version and streamingLimits only", async () => {
    const createDevicePreferenceStore = await loadStore();
    const { native, written } = fakeNative(null);
    const store = createDevicePreferenceStore(native);
    await settled(store);
    store.update("autoPlay", NON_DEFAULT_ACCOUNT.autoPlay);
    store.update("streamingLimits", { remoteMbps: 10 });
    store.update("skipModes", NON_DEFAULT_ACCOUNT.skipModes);
    store.update("continueWindow", NON_DEFAULT_ACCOUNT.continueWindow);
    store.update("streamingLimits", { localMbps: 80, remoteMbps: 10 });
    await flush();
    expect(written()).toHaveLength(2);
    for (const text of written()) {
      expect(Object.keys(parsed(text)).sort()).toEqual(["streamingLimits", "version"]);
      for (const key of ["autoPlay", "skipModes", "continueWindow"]) expect(text).not.toContain(key);
    }
    expect(parsed(written()[1])).toEqual({ version: 1, streamingLimits: { localMbps: 80, remoteMbps: 10 } });
    expect(store.get()).toEqual({ ...NON_DEFAULT_ACCOUNT, streamingLimits: { localMbps: 80, remoteMbps: 10 } });
  });
});

// --- item 4 -----------------------------------------------------------------------------------------------------------

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

function expectNone(text: string, secret: string, where: string) {
  for (const form of forms(secret)) expect(text, where).not.toContain(form);
  expect(text, where).not.toContain(TOKEN);
}

// Removes `//` and `/* */` comments, keeping string literals, so a comment may name what the code avoids.
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const MODULE_INDEX = "modules/preferences/src/index.ts";
const MODULE_KT = "modules/preferences/android/src/main/java/dev/octave/preferences/OctavePreferencesModule.kt";

function readSource(path: string): string {
  expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  return stripComments(readFileSync(join(repo, path), "utf8"));
}

describe("T9-02 item 4: the record never holds a token, credential, URL or play-session id", () => {
  it.each(Object.entries(SECRETS))("T9-02 item 4: the core writes and reads back no %s placed anywhere in a record", async (_, secret) => {
    const { encodeDeviceRecord, decodeDeviceRecord, sanitizePreferences } = await loadCore();
    for (const placed of placements(secret)) {
      const where = JSON.stringify(Object.keys(placed));
      expectNone(encodeDeviceRecord(sanitizePreferences(placed)), secret, where);
      expectNone(JSON.stringify(decodeDeviceRecord(recordText({ version: 1, ...placed }))), secret, where);
    }
  });

  it.each(Object.entries(SECRETS))("T9-02 item 4: updating the TV store with the %s in every place writes and keeps none of it", async (_, secret) => {
    const createDevicePreferenceStore = await loadStore();
    const { native, written } = fakeNative(null);
    const store = createDevicePreferenceStore(native);
    await settled(store);
    const kept: string[] = [];
    for (const placed of placements(secret)) {
      for (const [key, value] of Object.entries(placed)) {
        store.update(key as Key, value);
        kept.push(JSON.stringify(store.get()));
      }
      // A device write follows each round, so the written text is checked too.
      store.update("streamingLimits", { localMbps: 20 });
      kept.push(JSON.stringify(store.get()));
    }
    await flush();
    expect(written().length).toBeGreaterThan(0);
    for (const text of written()) expectNone(text, secret, "write");
    for (const text of kept) expectNone(text, secret, "get");
  });

  it.each(Object.entries(SECRETS))("T9-02 item 4: a stored record holding the %s in every place reads back none of it", async (_, secret) => {
    const createDevicePreferenceStore = await loadStore();
    for (const placed of placements(secret)) {
      const { native } = fakeNative(recordText({ version: 1, ...placed }));
      const store = createDevicePreferenceStore(native);
      await settled(store);
      expectNone(JSON.stringify(store.get()), secret, JSON.stringify(Object.keys(placed)));
    }
  });

  it("T9-02 item 4: the module's TypeScript declares OctavePreferencesNative with exactly read() and write(record), types only", () => {
    const source = readSource(MODULE_INDEX);
    const body = /export\s+interface\s+OctavePreferencesNative\s*\{([^}]*)\}/.exec(source);
    expect(body, "an exported interface OctavePreferencesNative").not.toBeNull();
    const members = [...(body?.[1] ?? "").matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*[(:<]/gm)].map(([, name]) => name);
    expect(members).toEqual(["read", "write"]);
    expect(body?.[1]).toMatch(/read\s*\(\s*\)\s*:\s*Promise\s*<\s*string\s*\|\s*null\s*>/);
    expect(body?.[1]).toMatch(/write\s*\(\s*\w+\s*:\s*string\s*\)\s*:\s*Promise\s*<\s*boolean\s*>/);
    expect(source).not.toMatch(/\bexport\s+(?:const|let|var|function|async|class|default|enum)\b/);
    expect(source).not.toMatch(/\brequireNativeModule\b|\brequireOptionalNativeModule\b/);
  });

  it('T9-02 item 4: the Expo module is OctavePreferences with AsyncFunction("read") and AsyncFunction("write") only, and no other function, property, constant, event or view', () => {
    const source = readSource(MODULE_KT);
    expect(source).toMatch(/\bName\s*\(\s*"OctavePreferences"\s*\)/);
    expect([...source.matchAll(/\bAsyncFunction\s*\(/g)].length).toBe(2);
    expect(source).toMatch(/\bAsyncFunction\s*\(\s*"read"\s*\)/);
    expect(source).toMatch(/\bAsyncFunction\s*\(\s*"write"\s*\)/);
    expect(source).not.toMatch(/(?<!Async)\bFunction\s*\(/);
    for (const call of ["Property", "Constants", "Constant", "Events", "View", "Prop", "OnStartObserving", "sendEvent"]) {
      expect(source, call).not.toMatch(new RegExp(`\\b${call}\\s*\\(`));
    }
  });
});

// --- item 5 -----------------------------------------------------------------------------------------------------------

describe("T9-02 item 5: the defaults", () => {
  it("T9-02 item 5: the core's defaults are auto-play on, countdown 10 s, Show a Skip button, No limit and 90 days", async () => {
    const { DEFAULT_PREFERENCES } = await loadCore();
    expect(DEFAULT_PREFERENCES).toEqual(DEFAULTS);
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true);
  });

  it("T9-02 item 5: a fresh TV store gives the defaults before ready", async () => {
    const createDevicePreferenceStore = await loadStore();
    const reading = deferred<string | null>();
    const { native } = fakeNative(reading.promise);
    const store = createDevicePreferenceStore(native);
    expect(store.get()).toEqual(DEFAULTS);
    reading.resolve(null);
    await settled(store);
  });

  const failingReads: [string, () => () => Native][] = [
    ["answers null", () => fakeNative(null).native],
    ['answers "not json"', () => fakeNative("not json").native],
    [
      "rejects",
      () => {
        const read = vi.fn(() => Promise.reject(new Error("read failed")));
        const write = vi.fn(async () => true);
        return () => ({ read, write });
      },
    ],
    [
      "throws synchronously from the loader",
      () => () => {
        throw new Error("The preferences module is not available on this platform.");
      },
    ],
  ];

  it.each(failingReads)("T9-02 item 5: after ready, a TV store whose native read %s gives the defaults", async (_, make) => {
    const createDevicePreferenceStore = await loadStore();
    let store: DeviceStore | undefined;
    expect(() => {
      store = createDevicePreferenceStore(make());
    }).not.toThrow();
    await settled(store as DeviceStore);
    expect((store as DeviceStore).get()).toEqual(DEFAULTS);
  });
});
