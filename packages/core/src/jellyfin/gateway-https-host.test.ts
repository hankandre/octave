// @vitest-environment node
// T4-02 item 8, the core's half (docs/specs/T4-02.md, D9, R10, R11): every vector of the shared https-hosts.json goes
// through the gateway constructor, over a transport that throws when it is called.
import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import { SignInFailure } from "../domain/sign-in-failure";
import { TransportError, type SignInRequest, type SignInResult, type Transport, type TransportRequest, type TransportResponse } from "../ports/transport";
import { JellyfinGateway } from "./gateway";
import vectors from "../../tests/fixtures/https-hosts.json";

class ThrowingTransport implements Transport {
  readonly requests: TransportRequest[] = [];
  signIns = 0;
  async signIn(_request: SignInRequest): Promise<SignInResult> {
    this.signIns += 1;
    throw new TransportError("network");
  }
  async request(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    throw new TransportError("network");
  }
  async endSession(): Promise<void> {
    throw new TransportError("network");
  }
}

const build = (address: string, transport: Transport) => new JellyfinGateway(address, webCrypto, transport, "install-1");

const admitted = [
  ...vectors.accepted.map((vector) => ({ ...vector, list: "accepted" })),
  ...vectors.invalidPunycode.map((vector) => ({ ...vector, list: "invalidPunycode" })),
];

describe("T4-02 item 8: https hosts", () => {
  it.each(vectors.refused)("T4-02 item 8: refuses $address as $kind before any request", ({ address, kind }) => {
    const transport = new ThrowingTransport();
    let thrown: unknown;
    try {
      build(address, transport);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SignInFailure);
    expect((thrown as SignInFailure).kind).toBe(kind);
    expect(transport.requests).toEqual([]);
    expect(transport.signIns).toBe(0);
  });

  it.each(admitted)("T4-02 item 8: admits $address ($list) as $serverUrl, and its probe reaches the transport", async ({ address, serverUrl }) => {
    const transport = new ThrowingTransport();
    const gateway = build(address, transport);
    expect(gateway.serverUrl).toBe(serverUrl);
    expect(transport.requests).toEqual([]);
    await expect(gateway.connect()).rejects.toThrow();
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.target).toMatchObject({ server: serverUrl });
  });
});
