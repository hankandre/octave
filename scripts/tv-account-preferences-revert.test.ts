// @vitest-environment node
// T9-09 item 4 (review follow-up): a failed save puts back what the server holds, not the default, when the
// account's read has not landed or was skipped for that key.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type Account = { continueWindow: string };
type Store = {
  get(): Account;
  ready: Promise<void>;
  useAccount(source: { read: () => Promise<unknown>; save: (change: unknown) => Promise<unknown> }): Promise<void>;
  saveAccount(key: "continueWindow", value: string): Promise<"saved" | "failed" | "no-account">;
};

const load = async () =>
  (await import(pathToFileURL(join(repo, "apps/tv/src/host/preferences.ts")).href)) as {
    createDevicePreferenceStore: (native: () => { read: () => Promise<null>; write: () => Promise<boolean> }) => Store;
  };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const account = (continueWindow: string) => ({ continueWindow, skipModes: { intro: "button", credits: "button" }, autoPlay: { enabled: true, countdownSeconds: 10 } });

async function newStore() {
  const { createDevicePreferenceStore } = await load();
  const store = createDevicePreferenceStore(() => ({ read: () => Promise.resolve(null), write: () => Promise.resolve(true) }));
  await store.ready;
  return store;
}

describe("T9-09 item 4: a failed save restores the server's value", () => {
  it("T9-09 item 4: a save that fails before the read lands leaves the read's value once it lands", async () => {
    const store = await newStore();
    const read = deferred<unknown>();
    const used = store.useAccount({ read: () => read.promise, save: () => Promise.reject(new Error("offline")) });
    await expect(store.saveAccount("continueWindow", "30")).resolves.toBe("failed");
    read.resolve(account("365"));
    await used;
    expect(store.get().continueWindow).toBe("365");
  });

  it("T9-09 item 4: a save that fails after a read that skipped its key shows the read's value", async () => {
    const store = await newStore();
    const read = deferred<unknown>();
    const save = deferred<unknown>();
    const used = store.useAccount({ read: () => read.promise, save: () => save.promise });
    const saving = store.saveAccount("continueWindow", "30");
    read.resolve(account("365"));
    await used;
    expect(store.get().continueWindow).toBe("30");
    save.reject(new Error("offline"));
    await expect(saving).resolves.toBe("failed");
    expect(store.get().continueWindow).toBe("365");
  });
});
