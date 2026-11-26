// T4-02 items 3 and 4 (docs/specs/T4-02.md, D5, D6): the probe is one tokenless request; a found server must report the
// id it was discovered with, before any confirmation; a private-LAN plain-HTTP server asks until the shared store holds it.
import { describe, expect, it, vi } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import { MemoryLanHttpConfirmations } from "../lan-http-confirmations";
import { TransportError, type SignInRequest, type SignInResult, type Transport, type TransportRequest, type TransportResponse } from "../ports/transport";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";
import { probeServer } from "./server-probe";

const ID = "0123456789abcdef0123456789abcdef";
const OTHER_ID = "fedcba9876543210fedcba9876543210";
const HTTPS = "https://media.example.test";
const LAN = "http://192.168.1.5:8096";
const PROBE = "GET /System/Info/Public";

const info = (over: Record<string, unknown> = {}) => ({ ServerName: "Fixture", Version: "10.11.11", Id: ID, ...over });

function rig(answer: unknown = info()) {
  const transport = new FakeTransport();
  transport.responses.set(PROBE, answer);
  const confirmations = new MemoryLanHttpConfirmations();
  const remember = vi.spyOn(confirmations, "remember");
  const open = vi.fn(async (address: string) => new JellyfinGateway(address, webCrypto, transport, "install-1", confirmations));
  return { transport, confirmations, remember, open };
}

const live = () => new AbortController().signal;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("T4-02 item 3: the probe sends no credentials", () => {
  it("T4-02 item 3: sends exactly one request, the public info probe with a server target, and signs in nowhere", async () => {
    const { transport, open } = rig();
    const outcome = await probeServer(open, { address: HTTPS }, live());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(HTTPS);
    expect(transport.requests.map((request) => `${request.method} ${request.url}`)).toEqual([PROBE]);
    expect(transport.requests[0]?.target).toEqual({ server: HTTPS, deviceId: "octave-unauthenticated" });
    expect(transport.signIns).toEqual([]);
    expect(outcome.kind).toBe("chosen");
    if (outcome.kind !== "chosen") return;
    expect(outcome.gateway.serverUrl).toBe(HTTPS);
    expect(outcome.connection).toMatchObject({ name: "Fixture", id: ID });
  });

  it("T4-02 item 3: a found server that reports another id fails, and nothing is confirmed", async () => {
    const { open, remember, transport } = rig(info({ Id: OTHER_ID }));
    const outcome = await probeServer(open, { address: LAN, discoveredId: ID }, live());
    expect(outcome).toEqual({ kind: "failed", failure: "not-the-discovered-server" });
    expect(remember).not.toHaveBeenCalled();
    expect(transport.requests).toHaveLength(1);
    expect(transport.signIns).toEqual([]);
  });

  it("T4-02 item 3: a found https server whose probe reports no id is not the discovered server", async () => {
    const { open, remember } = rig(info({ Id: undefined }));
    const outcome = await probeServer(open, { address: HTTPS, discoveredId: ID }, live());
    expect(outcome).toEqual({ kind: "failed", failure: "not-the-discovered-server" });
    expect(remember).not.toHaveBeenCalled();
  });

  it("T4-02 item 3: a found private-LAN plain-HTTP server whose probe reports no id fails as other, before the id check", async () => {
    const { open, remember } = rig(info({ Id: undefined }));
    const outcome = await probeServer(open, { address: LAN, discoveredId: ID }, live());
    expect(outcome).toEqual({ kind: "failed", failure: "other" });
    expect(remember).not.toHaveBeenCalled();
  });

  it("T4-02 item 3: an id that differs only in case and dashes is the same server", async () => {
    const { open } = rig(info({ Id: "01234567-89AB-CDEF-0123-456789ABCDEF" }));
    expect((await probeServer(open, { address: HTTPS, discoveredId: ID }, live())).kind).toBe("chosen");
  });

  it("T4-02 item 3: a typed server is not id-checked", async () => {
    const { open } = rig(info({ Id: undefined }));
    expect((await probeServer(open, { address: HTTPS }, live())).kind).toBe("chosen");
  });

  it("T4-02 item 3: an address refused by the gateway fails with its code and sends nothing", async () => {
    const { open, transport } = rig();
    expect(await probeServer(open, { address: "not a URL" }, live())).toEqual({ kind: "failed", failure: "not-an-address" });
    expect(await probeServer(open, { address: "http://media.example.com" }, live())).toEqual({ kind: "failed", failure: "refused-plain-http" });
    expect(transport.requests).toEqual([]);
  });

  it("T4-02 item 3: a factory that rejects fails as other", async () => {
    const open = async (): Promise<JellyfinGateway> => {
      throw new Error("The install id is not available.");
    };
    expect(await probeServer(open, { address: HTTPS }, live())).toEqual({ kind: "failed", failure: "other" });
  });

  it("T4-02 item 3: a transport failure is mapped by its code", async () => {
    const { open, transport } = rig();
    transport.failures.set(PROBE, new TransportError("network"));
    expect(await probeServer(open, { address: HTTPS }, live())).toEqual({ kind: "failed", failure: "unreachable" });
  });
});

describe("T4-02 item 4: the unencrypted connection", () => {
  it("T4-02 item 4: an unconfirmed private-LAN server asks, and records nothing by itself", async () => {
    const { open, remember } = rig();
    const outcome = await probeServer(open, { address: LAN }, live());
    expect(outcome.kind).toBe("confirm");
    expect(remember).not.toHaveBeenCalled();
    if (outcome.kind !== "confirm") return;
    expect(outcome.gateway.serverUrl).toBe(LAN);
    expect(outcome.connection.needsUnencryptedConfirmation).toBe(true);
  });

  it("T4-02 item 4: once the shared store holds the server and origin, a new gateway does not ask; another port asks again", async () => {
    const { open } = rig();
    const first = await probeServer(open, { address: LAN }, live());
    if (first.kind !== "confirm") throw new Error(`expected confirm, got ${first.kind}`);
    first.gateway.confirmUnencryptedConnection();
    expect((await probeServer(open, { address: `${LAN}/` }, live())).kind).toBe("chosen");
    expect((await probeServer(open, { address: "http://192.168.1.5:8920" }, live())).kind).toBe("confirm");
  });

  it.each([HTTPS, "http://localhost:8096", "http://127.0.0.1:8096"])("T4-02 item 4: %s needs no confirmation", async (address) => {
    const { open } = rig();
    expect((await probeServer(open, { address }, live())).kind).toBe("chosen");
  });

  it("T4-02 item 4: a public plain-HTTP address is refused before any request", async () => {
    const { open, transport } = rig();
    expect(await probeServer(open, { address: "http://media.example.com" }, live())).toEqual({ kind: "failed", failure: "refused-plain-http" });
    expect(transport.requests).toEqual([]);
  });
});

// A transport whose request never answers by itself; it rejects as the port says when the signal aborts.
class HeldTransport implements Transport {
  readonly requests: TransportRequest[] = [];
  async signIn(_request: SignInRequest): Promise<SignInResult> {
    throw new Error("The probe never signs in.");
  }
  request(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    return new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => reject(new TransportError("cancelled")));
    });
  }
  async endSession(): Promise<void> {}
}

describe("T4-02 item 3: cancelling the probe", () => {
  it("T4-02 item 3: an abort while connect is in flight resolves cancelled", async () => {
    const transport = new HeldTransport();
    const controller = new AbortController();
    const outcome = probeServer(async (address) => new JellyfinGateway(address, webCrypto, transport, "install-1"), { address: HTTPS }, controller.signal);
    await tick();
    expect(transport.requests).toHaveLength(1);
    controller.abort();
    expect(transport.requests[0]?.signal?.aborted).toBe(true);
    await expect(outcome).resolves.toEqual({ kind: "cancelled" });
  });

  it("T4-02 item 3: an abort while the gateway is still being built resolves cancelled at once, and a late gateway is never connected", async () => {
    const { transport, remember, confirmations } = rig();
    const building = deferred<JellyfinGateway>();
    const controller = new AbortController();
    let settled: unknown;
    const outcome = probeServer(() => building.promise, { address: LAN }, controller.signal).then((value) => (settled = value));
    controller.abort();
    await tick();
    expect(settled).toEqual({ kind: "cancelled" });
    building.resolve(new JellyfinGateway(LAN, webCrypto, transport, "install-1", confirmations));
    await outcome;
    await tick();
    expect(transport.requests).toEqual([]);
    expect(remember).not.toHaveBeenCalled();
  });

  it("T4-02 item 3: a late rejection after the abort is swallowed", async () => {
    const building = deferred<JellyfinGateway>();
    const controller = new AbortController();
    const outcome = probeServer(() => building.promise, { address: HTTPS }, controller.signal);
    controller.abort();
    await expect(outcome).resolves.toEqual({ kind: "cancelled" });
    building.reject(new Error("late"));
    await tick();
  });

  it("T4-02 item 3: a signal already aborted gives cancelled without building a gateway", async () => {
    const { open } = rig();
    const controller = new AbortController();
    controller.abort();
    await expect(probeServer(open, { address: HTTPS }, controller.signal)).resolves.toEqual({ kind: "cancelled" });
    expect(open).not.toHaveBeenCalled();
  });
});
