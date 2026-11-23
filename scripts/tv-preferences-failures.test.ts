// @vitest-environment node
// T9-02 D6 and D7 (docs/specs/T9-02.md): a failed write keeps the new value in memory and does not stop the next write;
// hostPreferences builds one store lazily, and where the module is missing (the tvOS sibling) it gives the defaults.
// Loaded from a path built at run time, as scripts/tv-preferences.test.ts does.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type Store = {
  get(): { streamingLimits: { localMbps?: number; remoteMbps?: number } };
  update(key: string, value: unknown): void;
  subscribe(listener: () => void): () => void;
  ready: Promise<void>;
};
type Native = { read: () => Promise<string | null>; write: (record: string) => Promise<boolean> };

async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(join(repo, path)).href)) as T;
}

const loadStore = async () =>
  (await load<{ createDevicePreferenceStore: (native: () => Native) => Store }>("apps/tv/src/host/preferences.ts")).createDevicePreferenceStore;

async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("T9-02 D6: failed writes", () => {
  it.each([
    ["answers false", () => Promise.resolve(false)],
    ["rejects", () => Promise.reject(new Error("write failed"))],
  ])("a write that %s keeps the value and the next update still writes", async (_, failing) => {
    const createDevicePreferenceStore = await loadStore();
    const write = vi.fn(failing);
    const store = createDevicePreferenceStore(() => ({ read: async () => null, write }));
    await store.ready;
    store.update("streamingLimits", { localMbps: 20 });
    await flush();
    expect(store.get().streamingLimits).toEqual({ localMbps: 20 });
    store.update("streamingLimits", { localMbps: 40 });
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(store.get().streamingLimits).toEqual({ localMbps: 40 });
  });

  it("a loader that throws on write keeps the value and does not throw to the caller", async () => {
    const createDevicePreferenceStore = await loadStore();
    const store = createDevicePreferenceStore(() => {
      throw new Error("The preferences module is not available on this platform.");
    });
    await store.ready;
    expect(() => store.update("streamingLimits", { remoteMbps: 8 })).not.toThrow();
    await flush();
    expect(store.get().streamingLimits).toEqual({ remoteMbps: 8 });
  });

  it("a read that answers the record already in memory does not notify", async () => {
    const createDevicePreferenceStore = await loadStore();
    const store = createDevicePreferenceStore(() => ({ read: async () => '{"version":1,"streamingLimits":{}}', write: async () => true }));
    const listener = vi.fn();
    store.subscribe(listener);
    await store.ready;
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("T9-02: hostPreferences", () => {
  it("builds one store on first use and, with the tvOS sibling loader, gives the defaults", async () => {
    const { hostPreferences } = await load<{ hostPreferences: () => Store }>("apps/tv/src/host/host-preferences.ts");
    const store = hostPreferences();
    expect(hostPreferences()).toBe(store);
    await store.ready;
    expect(store.get().streamingLimits).toEqual({});
  });
});
