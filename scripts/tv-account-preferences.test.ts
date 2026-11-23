// @vitest-environment node
// T9-09 items 1, 4, 5 and 7 (docs/specs/T9-09.md D6, D7, D8): the TV's preference store follows the active account.
// apps/tv/src/host/preferences.ts gains useAccount(source) and saveAccount(key, value); update() of an account key
// saves through the source and writes nothing to the device record. The source is an AccountPreferenceSource
// (read, save) built from the gateway; here it is a fake whose promises resolve by hand to test ordering.
// The module is loaded at run time from a path built here, as scripts/tv-preferences.test.ts does.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type Account = {
  continueWindow: string;
  skipModes: { intro: string; credits: string };
  autoPlay: { enabled: boolean; countdownSeconds: number };
};
type Values = Account & { streamingLimits: { localMbps?: number; remoteMbps?: number } };
type AccountKey = keyof Account;
type Source = { read: () => Promise<Account>; save: (change: Partial<Account>) => Promise<Account> };
type Native = { read: () => Promise<string | null>; write: (record: string) => Promise<boolean> };
type Store = {
  get(): Values;
  update(key: keyof Values, value: unknown): void;
  subscribe(listener: () => void): () => void;
  ready: Promise<void>;
  useAccount(source: Source | undefined): Promise<void>;
  saveAccount(key: AccountKey, value: unknown): Promise<"saved" | "failed" | "no-account">;
};

const loadStore = async () =>
  (await import(pathToFileURL(join(repo, "apps/tv/src/host/preferences.ts")).href)) as { createDevicePreferenceStore: (native: () => Native) => Store };
const loadMapping = async () =>
  (await import(pathToFileURL(join(repo, "packages/core/src/jellyfin/account-preferences.ts")).href)) as {
    toAccountPreferences: (dto: unknown) => Account;
  };

const DEFAULT_ACCOUNT: Account = {
  continueWindow: "90",
  skipModes: { intro: "button", credits: "button" },
  autoPlay: { enabled: true, countdownSeconds: 10 },
};
const OTHER: Account = {
  continueWindow: "30",
  skipModes: { intro: "auto", credits: "none" },
  autoPlay: { enabled: false, countdownSeconds: 5 },
};
const THIRD: Account = {
  continueWindow: "365",
  skipModes: { intro: "none", credits: "auto" },
  autoPlay: { enabled: true, countdownSeconds: 15 },
};
const accountOf = (values: Values): Account => ({ continueWindow: values.continueWindow, skipModes: values.skipModes, autoPlay: values.autoPlay });

async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeNative(answer: string | null = null) {
  const read = vi.fn(() => Promise.resolve(answer));
  const write = vi.fn((record: string) => {
    void record;
    return Promise.resolve(true);
  });
  return { native: () => ({ read, write }), read, write };
}

// A source that answers at once with `values`; `save` answers the change applied to what it holds.
function fakeSource(values: Account = DEFAULT_ACCOUNT) {
  let held = values;
  const read = vi.fn(() => Promise.resolve(held));
  const save = vi.fn((change: Partial<Account>) => {
    held = { ...held, ...change };
    return Promise.resolve(held);
  });
  return { read, save } satisfies Source;
}

// A source whose read and saves settle when the test says so.
function manualSource() {
  const reads: ReturnType<typeof deferred<Account>>[] = [];
  const saves: ReturnType<typeof deferred<Account>>[] = [];
  const read = vi.fn(() => {
    const next = deferred<Account>();
    reads.push(next);
    return next.promise;
  });
  const save = vi.fn((change: Partial<Account>) => {
    void change;
    const next = deferred<Account>();
    saves.push(next);
    return next.promise;
  });
  return { read, save, reads, saves };
}

async function newStore(nativeAnswer: string | null = null) {
  const { createDevicePreferenceStore } = await loadStore();
  const fake = fakeNative(nativeAnswer);
  const store = createDevicePreferenceStore(fake.native);
  await store.ready;
  return { store, ...fake };
}

function counted(store: Store) {
  const count = { n: 0 };
  store.subscribe(() => {
    count.n += 1;
  });
  return count;
}

describe("T9-09 item 1: the store reads from and saves to the account's source only", () => {
  it("T9-09 item 1: after useAccount(source), get() holds the source's values", async () => {
    const { store } = await newStore();
    await store.useAccount(fakeSource(OTHER));
    expect(accountOf(store.get())).toEqual(OTHER);
  });

  it("T9-09 item 1: useAccount notifies when the read changes the values", async () => {
    const { store } = await newStore();
    const count = counted(store);
    await store.useAccount(fakeSource(OTHER));
    expect(count.n).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["autoPlay", { enabled: false, countdownSeconds: 5 }],
    ["skipModes", { intro: "auto", credits: "none" }],
    ["continueWindow", "180"],
  ] as const)("T9-09 item 1: update(%s) calls source.save once with that one key and writes nothing natively", async (key, value) => {
    const { store, write } = await newStore();
    const source = fakeSource();
    await store.useAccount(source);
    store.update(key, value);
    await flush();
    expect(source.save).toHaveBeenCalledTimes(1);
    expect(source.save).toHaveBeenCalledWith({ [key]: value });
    expect(write).not.toHaveBeenCalled();
    expect(store.get()[key]).toEqual(value);
  });

  it("T9-09 item 1: an account update is not part of a later device write", async () => {
    const { store, write } = await newStore();
    await store.useAccount(fakeSource());
    store.update("continueWindow", "180");
    store.update("streamingLimits", { localMbps: 20 });
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0]?.[0] as string)).toEqual({ version: 1, streamingLimits: { localMbps: 20 } });
  });

  it("T9-09 item 1: saveAccount resolves saved when the source saves", async () => {
    const { store } = await newStore();
    await store.useAccount(fakeSource());
    await expect(store.saveAccount("continueWindow", "365")).resolves.toBe("saved");
    expect(store.get().continueWindow).toBe("365");
  });

  it("T9-09 item 1: a read sets only the fields not changed on this account since the switch", async () => {
    const { store } = await newStore();
    const source = manualSource();
    const used = store.useAccount(source);
    void store.saveAccount("continueWindow", "30");
    source.reads[0]?.resolve({ ...THIRD, continueWindow: "365" });
    await used;
    expect(store.get().continueWindow).toBe("30");
    expect(store.get().skipModes).toEqual(THIRD.skipModes);
    expect(store.get().autoPlay).toEqual(THIRD.autoPlay);
  });
});

describe("T9-09 item 4: a failed read gives the defaults, a failed save is reported", () => {
  it("T9-09 item 4: a read that rejects keeps the defaults and useAccount resolves", async () => {
    const { store } = await newStore();
    await expect(store.useAccount({ read: () => Promise.reject(new Error("offline")), save: vi.fn() })).resolves.toBeUndefined();
    expect(accountOf(store.get())).toEqual(DEFAULT_ACCOUNT);
  });

  it("T9-09 item 4: a read that throws synchronously keeps the defaults and useAccount resolves", async () => {
    const { store } = await newStore();
    const source: Source = {
      read: () => {
        throw new Error("sync");
      },
      save: vi.fn(),
    };
    await expect(store.useAccount(source)).resolves.toBeUndefined();
    expect(accountOf(store.get())).toEqual(DEFAULT_ACCOUNT);
  });

  it("T9-09 item 4: a read that settles only after a later useAccount changes nothing, and its useAccount then resolves", async () => {
    const { store } = await newStore();
    const first = manualSource();
    let firstSettled = false;
    const firstUse = store.useAccount(first).then(() => {
      firstSettled = true;
    });
    await store.useAccount({ read: () => Promise.reject(new Error("offline")), save: vi.fn() });
    expect(accountOf(store.get())).toEqual(DEFAULT_ACCOUNT);
    first.reads[0]?.resolve(OTHER);
    await firstUse;
    expect(firstSettled).toBe(true);
    expect(accountOf(store.get())).toEqual(DEFAULT_ACCOUNT);
  });

  it.each([
    ["rejects", () => Promise.reject(new Error("offline"))],
    [
      "throws",
      () => {
        throw new Error("sync");
      },
    ],
  ])("T9-09 item 4: a save that %s resolves failed, get() shows the previous value, listeners were told twice", async (_name, save) => {
    const { store } = await newStore();
    await store.useAccount({ read: () => Promise.resolve(OTHER), save: save as Source["save"] });
    const count = counted(store);
    await expect(store.saveAccount("continueWindow", "365")).resolves.toBe("failed");
    expect(store.get().continueWindow).toBe("30");
    expect(count.n).toBe(2);
  });

  it("T9-09 item 4: a failure after a newer change of the same field keeps the newer value", async () => {
    const { store } = await newStore();
    const source = manualSource();
    const used = store.useAccount(source);
    source.reads[0]?.resolve(DEFAULT_ACCOUNT);
    await used;
    const first = store.saveAccount("continueWindow", "30");
    const second = store.saveAccount("continueWindow", "365");
    await flush();
    source.saves[0]?.reject(new Error("offline"));
    await flush();
    source.saves[1]?.resolve({ ...DEFAULT_ACCOUNT, continueWindow: "365" });
    await expect(first).resolves.toBe("failed");
    await expect(second).resolves.toBe("saved");
    expect(store.get().continueWindow).toBe("365");
  });

  it("T9-09 item 4: with no account (no useAccount) saveAccount sets the value, tells listeners once, calls nothing", async () => {
    const { store, write } = await newStore();
    const count = counted(store);
    await expect(store.saveAccount("continueWindow", "180")).resolves.toBe("no-account");
    expect(store.get().continueWindow).toBe("180");
    expect(count.n).toBe(1);
    expect(write).not.toHaveBeenCalled();
  });

  it("T9-09 item 4: after useAccount(undefined) saveAccount resolves no-account and no source is called", async () => {
    const { store } = await newStore();
    const source = fakeSource(OTHER);
    await store.useAccount(source);
    source.read.mockClear();
    source.save.mockClear();
    await store.useAccount(undefined);
    expect(accountOf(store.get())).toEqual(DEFAULT_ACCOUNT);
    const count = counted(store);
    await expect(store.saveAccount("autoPlay", { enabled: false, countdownSeconds: 15 })).resolves.toBe("no-account");
    expect(store.get().autoPlay).toEqual({ enabled: false, countdownSeconds: 15 });
    expect(count.n).toBe(1);
    expect(source.read).not.toHaveBeenCalled();
    expect(source.save).not.toHaveBeenCalled();
  });

  it("T9-09 item 4: useAccount(undefined) reads nothing and leaves the defaults", async () => {
    const { store } = await newStore();
    await expect(store.useAccount(undefined)).resolves.toBeUndefined();
    expect(accountOf(store.get())).toEqual(DEFAULT_ACCOUNT);
  });

  it("T9-09 item 4: a value saved with no account is dropped at the next useAccount", async () => {
    const { store } = await newStore();
    await store.saveAccount("continueWindow", "180");
    await store.useAccount({ read: () => Promise.reject(new Error("offline")), save: vi.fn() });
    expect(store.get().continueWindow).toBe("90");
  });
});

describe("T9-09 item 5: switching accounts switches the settings", () => {
  it("T9-09 item 5: useAccount(a) then useAccount(b) shows b's values, with the defaults between, never a's", async () => {
    const { store } = await newStore();
    await store.useAccount(fakeSource(OTHER));
    expect(accountOf(store.get())).toEqual(OTHER);
    const b = manualSource();
    const used = store.useAccount(b);
    expect(accountOf(store.get())).toEqual(DEFAULT_ACCOUNT);
    await flush();
    expect(accountOf(store.get())).toEqual(DEFAULT_ACCOUNT);
    b.reads[0]?.resolve(THIRD);
    await used;
    expect(accountOf(store.get())).toEqual(THIRD);
  });

  it("T9-09 item 5: a's read landing after the switch changes nothing", async () => {
    const { store } = await newStore();
    const a = manualSource();
    const usedA = store.useAccount(a);
    await store.useAccount(fakeSource(THIRD));
    a.reads[0]?.resolve(OTHER);
    await usedA;
    expect(accountOf(store.get())).toEqual(THIRD);
  });

  it("T9-09 item 5: a save started under a goes to a only, and its failure after the switch leaves b's values", async () => {
    const { store } = await newStore();
    const a = manualSource();
    const usedA = store.useAccount(a);
    a.reads[0]?.resolve(DEFAULT_ACCOUNT);
    await usedA;
    const saving = store.saveAccount("continueWindow", "180");
    await flush();
    const b = fakeSource(THIRD);
    await store.useAccount(b);
    a.saves[0]?.reject(new Error("offline"));
    await saving;
    expect(a.save).toHaveBeenCalledTimes(1);
    expect(b.save).not.toHaveBeenCalled();
    expect(accountOf(store.get())).toEqual(THIRD);
  });

  it("T9-09 item 5: a save of a that succeeds after the switch does not touch b's values", async () => {
    const { store } = await newStore();
    const a = manualSource();
    const usedA = store.useAccount(a);
    a.reads[0]?.resolve(DEFAULT_ACCOUNT);
    await usedA;
    const saving = store.saveAccount("continueWindow", "180");
    await flush();
    await store.useAccount(fakeSource(THIRD));
    const count = counted(store);
    a.saves[0]?.resolve({ ...DEFAULT_ACCOUNT, continueWindow: "180" });
    await saving;
    expect(accountOf(store.get())).toEqual(THIRD);
    expect(count.n).toBe(0);
  });

  it("T9-09 item 5: two devices over one account record: the second reads what the first saved", async () => {
    const record: Account = { ...DEFAULT_ACCOUNT };
    const shared: Source = {
      read: () => Promise.resolve({ ...record }),
      save: (change) => {
        Object.assign(record, change);
        return Promise.resolve({ ...record });
      },
    };
    const first = await newStore();
    const second = await newStore();
    await first.store.useAccount(shared);
    await expect(first.store.saveAccount("continueWindow", "180")).resolves.toBe("saved");
    await second.store.useAccount(shared);
    expect(second.store.get().continueWindow).toBe("180");
    expect(first.write).not.toHaveBeenCalled();
    expect(second.write).not.toHaveBeenCalled();
  });
});

describe("T9-09 item 7: a window left from before the owner's values reads as 90", () => {
  it.each(["7", "14"])("T9-09 item 7: a device record holding continueWindow %s beside streamingLimits, and an account with no window, give 90", async (window) => {
    const record = JSON.stringify({ version: 1, streamingLimits: { localMbps: 20 }, continueWindow: window });
    const { toAccountPreferences } = await loadMapping();
    const { store } = await newStore(record);
    expect(store.get().continueWindow).toBe("90");
    expect(store.get().streamingLimits).toEqual({ localMbps: 20 });
    await store.useAccount({ read: () => Promise.resolve(toAccountPreferences({ CustomPrefs: {} })), save: vi.fn() });
    expect(store.get().continueWindow).toBe("90");
    expect(store.get().streamingLimits).toEqual({ localMbps: 20 });
  });

  it.each(["7", "14"])("T9-09 item 7: an account record holding octave.continueWindow %s gives 90 after useAccount", async (window) => {
    const { toAccountPreferences } = await loadMapping();
    const { store } = await newStore();
    await store.useAccount({ read: () => Promise.resolve(toAccountPreferences({ CustomPrefs: { "octave.continueWindow": window } })), save: vi.fn() });
    expect(store.get().continueWindow).toBe("90");
  });

  it.each(["7", "14"])("T9-09 item 7: a source that answers window %s is read through the allowlist as 90", async (window) => {
    const { store } = await newStore();
    await store.useAccount({ read: () => Promise.resolve({ ...OTHER, continueWindow: window }), save: vi.fn() });
    expect(store.get().continueWindow).toBe("90");
  });
});
