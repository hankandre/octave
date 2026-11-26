// @vitest-environment node
// T4-05 D6: the app's SessionRestore over the session module's restoreSessions keeps only well-formed entries, in the
// module's order, copies only the named fields, and answers an empty list for a rejection or any other shape.
import { describe, expect, it } from "vitest";
import { createSessionRestore, type SessionNative } from "../apps/tv/src/host/transport";

const SESSION = "0123456789abcdef0123456789abcd01";
const OTHER = "0123456789abcdef0123456789abcd02";

const good = (session = SESSION, over: Record<string, unknown> = {}) => ({
  session,
  server: "https://media.example.test",
  deviceId: "fixture-device-id-1",
  userId: "user-1",
  serverId: "fedcba9876543210fedcba9876543210",
  userName: "Fixture Viewer",
  ...over,
});

function native(restoreSessions: () => Promise<unknown>): SessionNative {
  const unused = async () => ({ error: "refused" });
  return { signIn: unused, request: unused, endSession: unused, restoreSessions };
}

const restored = (answer: () => Promise<unknown>) => createSessionRestore(native(answer)).restoreSessions();

describe("T4-05 item 2: the app's restore adapter", () => {
  it("keeps well-formed entries in order, with only the named fields", async () => {
    const { userName: _dropped, ...unnamed } = good(OTHER);
    await expect(restored(async () => ({ sessions: [good(SESSION, { extra: "x" }), unnamed] }))).resolves.toEqual([good(), unnamed]);
  });

  it.each([
    ["an id that is not 32 lower-case hex digits", good("0123456789ABCDEF0123456789ABCD01")],
    ["an empty server id", good(SESSION, { serverId: "" })],
    ["a missing user id", good(SESSION, { userId: undefined })],
    ["a user name that is not a string", good(SESSION, { userName: 7 })],
    ["a number for the server", good(SESSION, { server: 1 })],
    ["not a map", "text"],
  ])("drops %s", async (_name, entry) => {
    await expect(restored(async () => ({ sessions: [entry, good(OTHER)] }))).resolves.toEqual([good(OTHER)]);
  });

  it.each([
    ["a rejection", () => Promise.reject(new Error("fixture"))],
    ["an error map", async () => ({ error: "network" })],
    ["no list", async () => ({ sessions: "x" })],
    ["null", async () => null],
  ])("answers an empty list for %s", async (_name, answer) => {
    await expect(restored(answer)).resolves.toEqual([]);
  });

  it("answers an empty list when the module has no restoreSessions", async () => {
    const unused = async () => ({});
    await expect(createSessionRestore({ signIn: unused, request: unused, endSession: unused }).restoreSessions()).resolves.toEqual([]);
  });
});
