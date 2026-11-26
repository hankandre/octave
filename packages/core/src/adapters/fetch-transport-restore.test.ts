// @vitest-environment node
// T4-05 D6: the reference transport implements SessionRestore over its live sessions only: a sign-in that named a server
// id is listed, newest first, with no token; one that named none is not; an ended session is not; a new transport (a
// restart) lists nothing.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { FetchTransport } from "./fetch-transport";
import { systemClock } from "./system-clock";
import { webCrypto } from "./web-crypto";

const TOKEN = "fixture-token-restore-1";
const servers: Server[] = [];
let answerServerId: string | undefined = "server-9";

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function listen(): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(request.url?.startsWith("/Users/Authenticate") ? 200 : 204, { "content-type": "application/json" });
      const body = { AccessToken: TOKEN, User: { Id: "user-1", Name: "Louise" }, ...(answerServerId === undefined ? {} : { ServerId: answerServerId }) };
      response.end(request.url?.startsWith("/Users/Authenticate") ? JSON.stringify(body) : "");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const transport = () => new FetchTransport({ client: { version: "0.1.0", deviceName: "Octave Test" }, crypto: webCrypto, clock: systemClock });
const credential = { kind: "password", username: "Louise", password: "fixture" } as const;

describe("T4-05: the reference transport lists its live sessions", () => {
  it("lists sessions with a server id, newest first, without the token, and none after a restart", async () => {
    const server = await listen();
    const adapter = transport();
    answerServerId = "server-9";
    const first = await adapter.signIn({ server, deviceId: "device-1", credential, timeoutMs: 5_000 });
    const second = await adapter.signIn({ server, deviceId: "device-1", credential, timeoutMs: 5_000 });
    answerServerId = undefined;
    const unnamed = await adapter.signIn({ server, deviceId: "device-1", credential, timeoutMs: 5_000 });

    const listed = await adapter.restoreSessions();

    expect(listed.map((entry) => entry.session)).toEqual([second.session, first.session]);
    expect(listed[0]).toEqual({ session: second.session, server, deviceId: "device-1", userId: "user-1", serverId: "server-9", userName: "Louise" });
    expect(JSON.stringify(listed)).not.toContain(TOKEN);
    expect(listed.some((entry) => entry.session === unnamed.session)).toBe(false);

    await adapter.endSession(first.session, { timeoutMs: 5_000 });
    expect((await adapter.restoreSessions()).map((entry) => entry.session)).toEqual([second.session]);
    await expect(transport().restoreSessions()).resolves.toEqual([]);
  });
});
