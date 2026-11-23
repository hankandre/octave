import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import type { TransportRequest, TransportResponse } from "../ports/transport";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";

// T9-09 item 5 (review follow-up): a save belongs to the session that asked for it. A sign-in that replaces the
// session before the save's GET or POST drops the save; no write goes out under the new session.
const PATH = "/DisplayPreferences/octave";

class GatedTransport extends FakeTransport {
  gate?: Promise<void>;
  override async request(request: TransportRequest): Promise<TransportResponse> {
    const answer = await super.request(request);
    if (request.method === "GET" && request.path === PATH && this.gate) await this.gate;
    return answer;
  }
}

async function signedIn() {
  const transport = new GatedTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "token-1", User: { Id: "user-1", Name: "Louise" } });
  transport.responses.set(`GET ${PATH}`, { Id: "octave", Client: "octave", CustomPrefs: {} });
  const gateway = new JellyfinGateway("https://media.test", webCrypto, transport, "install-1");
  await gateway.login("Louise", "password");
  transport.requests = [];
  return { gateway, transport };
}

const switchUser = async (gateway: JellyfinGateway, transport: FakeTransport) => {
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "token-2", User: { Id: "user-2", Name: "Marc" } });
  await gateway.login("Marc", "password");
};
const posts = (transport: FakeTransport) => transport.requests.filter((request) => request.method === "POST");

describe("T9-09 item 5: a save is dropped when the session changed", () => {
  it("T9-09 item 5: a sign-in between the GET and the POST sends no POST", async () => {
    const { gateway, transport } = await signedIn();
    let open!: () => void;
    transport.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const saving = gateway.saveAccountPreferences({ continueWindow: "30" });
    const outcome = expect(saving).rejects.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    await switchUser(gateway, transport);
    transport.requests = transport.requests.filter((request) => request.method === "GET");
    open();
    await outcome;
    expect(posts(transport)).toEqual([]);
  });

  it("T9-09 item 5: a save queued behind another does nothing when a sign-in replaces its session first", async () => {
    const { gateway, transport } = await signedIn();
    let open!: () => void;
    transport.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = gateway.saveAccountPreferences({ continueWindow: "30" });
    const second = gateway.saveAccountPreferences({ autoPlay: { enabled: false, countdownSeconds: 5 } });
    const outcomes = Promise.allSettled([first, second]);
    await new Promise((resolve) => setImmediate(resolve));
    await switchUser(gateway, transport);
    transport.requests = [];
    transport.gate = undefined;
    open();
    const [a, b] = await outcomes;
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("rejected");
    expect(transport.requests).toEqual([]);
  });

  it("T9-09 item 5: with no sign-in change the save still goes out as one GET then one POST", async () => {
    const { gateway, transport } = await signedIn();
    await gateway.saveAccountPreferences({ continueWindow: "30" });
    expect(transport.requests.map((request) => request.method)).toEqual(["GET", "POST"]);
  });
});
