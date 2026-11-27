// @vitest-environment node
// T4-05, guardian G-L3: a restoreSessions call that never answers (a Keystore that hangs) must not hold "Loading…" for
// ever. The app's adapter answers an empty list once its deadline passes, which opens sign-in's first step and deletes
// nothing; an answer that arrives later is dropped. An answer before the deadline is used as before.
import { describe, expect, it } from "vitest";
import { FakeClock } from "../packages/core/src/ports/fake-clock";
import { createSessionRestore, type SessionNative } from "../apps/tv/src/host/transport";

const SESSION = "0123456789abcdef0123456789abcd01";
const listed = { sessions: [{ session: SESSION, server: "https://media.example.test", deviceId: "d", userId: "u", serverId: "s" }] };

function native(restoreSessions: () => Promise<unknown>): SessionNative {
  const unused = async () => ({ error: "refused" });
  return { signIn: unused, request: unused, endSession: unused, restoreSessions };
}

describe("T4-05 G-L3: the restore adapter's deadline", () => {
  it("answers an empty list once the deadline passes, and drops a late answer", async () => {
    const clock = new FakeClock(0);
    let answer: (value: unknown) => void = () => undefined;
    const restore = createSessionRestore(native(() => new Promise((resolve) => (answer = resolve))), { clock, timeoutMs: 10_000 });
    let settled: unknown;
    void restore.restoreSessions().then((value) => (settled = value));

    await clock.advance(9_999);
    expect(settled).toBeUndefined();
    await clock.advance(1);
    expect(settled).toEqual([]);

    answer(listed);
    await clock.advance(1);
    expect(settled).toEqual([]);
  });

  it("uses an answer that arrives before the deadline", async () => {
    const clock = new FakeClock(0);
    const restore = createSessionRestore(native(async () => listed), { clock, timeoutMs: 10_000 });
    await expect(restore.restoreSessions()).resolves.toEqual([{ session: SESSION, server: "https://media.example.test", deviceId: "d", userId: "u", serverId: "s" }]);
  });
});
