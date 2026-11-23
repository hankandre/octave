import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import { TransportError } from "../ports/transport";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";

// T9-09 items 1, 3 and 4 (docs/specs/T9-09.md D1 to D5, R1): the two gateway methods over the core's fake transport.
// Every request is asserted by method, path, query pairs in order and body text, in R1's order.
const GET = "GET /DisplayPreferences/octave";
const POST = "POST /DisplayPreferences/octave";

async function signedIn() {
  const transport = new FakeTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "token-1", User: { Id: "user-1", Name: "Louise" } });
  const gateway = new JellyfinGateway("https://media.test", webCrypto, transport, "install-1");
  await gateway.login("Louise", "password");
  transport.requests = [];
  return { gateway, transport };
}

const KEYS = {
  "octave.continueWindow": "180",
  "octave.autoPlay": "false",
  "octave.autoPlayCountdown": "15",
  "octave.skipIntro": "auto",
  "octave.skipCredits": "none",
};
const record = (customPrefs: unknown) => ({ Id: "octave", Client: "octave", SortBy: "SortName", CustomPrefs: customPrefs });
const routes = (transport: FakeTransport) => transport.requests.map((request) => `${request.method} ${request.url}`);

describe("T9-09 item 1: reading the account's preferences", () => {
  it("T9-09 item 1: sends exactly one GET /DisplayPreferences/octave with userId then client=octave", async () => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record(KEYS));
    await gateway.accountPreferences();
    expect(routes(transport)).toEqual([GET]);
    expect(transport.requests[0]?.query).toEqual([
      ["userId", "user-1"],
      ["client", "octave"],
    ]);
    expect(transport.requests[0]?.data).toBeUndefined();
  });

  it("T9-09 item 1: maps an answer holding the five keys to the values of D2's table", async () => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record(KEYS));
    await expect(gateway.accountPreferences()).resolves.toEqual({
      continueWindow: "180",
      skipModes: { intro: "auto", credits: "none" },
      autoPlay: { enabled: false, countdownSeconds: 15 },
    });
  });

  it.each(["30", "90", "180", "365", "all"])("T9-09 item 1: reads window %s", async (value) => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record({ "octave.continueWindow": value }));
    await expect(gateway.accountPreferences()).resolves.toMatchObject({ continueWindow: value });
  });

  it.each([5, 10, 15])("T9-09 item 1: reads countdown %i", async (seconds) => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record({ "octave.autoPlay": "true", "octave.autoPlayCountdown": String(seconds) }));
    await expect(gateway.accountPreferences()).resolves.toMatchObject({ autoPlay: { enabled: true, countdownSeconds: seconds } });
  });

  it.each(["button", "auto", "none"])("T9-09 item 1: reads skip mode %s", async (mode) => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record({ "octave.skipIntro": mode, "octave.skipCredits": mode }));
    await expect(gateway.accountPreferences()).resolves.toMatchObject({ skipModes: { intro: mode, credits: mode } });
  });

  it("T9-09 item 1: a signed-out gateway throws before any request", async () => {
    const transport = new FakeTransport();
    const gateway = new JellyfinGateway("https://media.test", webCrypto, transport, "install-1");
    await expect(gateway.accountPreferences()).rejects.toThrow();
    await expect(gateway.saveAccountPreferences({ continueWindow: "30" })).rejects.toThrow();
    expect(transport.requests).toEqual([]);
  });
});

describe("T9-09 item 1: saving the account's preferences", () => {
  it("T9-09 item 1: sends the GET then one POST to the same path and query, and no third request", async () => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record({ chromecastVersion: "stable", "octave.continueWindow": "180", "octave.skipIntro": "auto" }));
    const saved = await gateway.saveAccountPreferences({ autoPlay: { enabled: false, countdownSeconds: 5 } });
    expect(routes(transport)).toEqual([GET, POST]);
    for (const request of transport.requests) {
      expect(request.query).toEqual([
        ["userId", "user-1"],
        ["client", "octave"],
      ]);
    }
    expect(saved).toEqual({
      continueWindow: "180",
      skipModes: { intro: "auto", credits: "button" },
      autoPlay: { enabled: false, countdownSeconds: 5 },
    });
  });

  it("T9-09 item 1: the POST body text is R1's, D4's fields in D4's order with CustomPrefs last", async () => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, {
      Id: "golden-display-preferences-id",
      Client: "octave",
      SortBy: "SortName",
      CustomPrefs: { chromecastVersion: "stable", "octave.continueWindow": "180", "octave.skipIntro": "auto" },
    });
    await gateway.saveAccountPreferences({ autoPlay: { enabled: false, countdownSeconds: 5 } });
    expect(JSON.stringify(transport.requests[1]?.data)).toBe(
      '{"Id":"octave","Client":"octave","SortBy":"SortName","SortOrder":"Ascending","RememberIndexing":false,"RememberSorting":false,"ScrollDirection":"Horizontal","ShowBackdrop":true,"ShowSidebar":false,"PrimaryImageHeight":250,"PrimaryImageWidth":250,"CustomPrefs":{"octave.continueWindow":"180","octave.autoPlay":"false","octave.autoPlayCountdown":"5","octave.skipIntro":"auto","octave.skipCredits":"button"}}',
    );
  });

  it("T9-09 item 1: a change to one field leaves the others as the account holds them", async () => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record(KEYS));
    await gateway.saveAccountPreferences({ continueWindow: "30" });
    const body = transport.requests[1]?.data as { CustomPrefs: Record<string, string> };
    expect(body.CustomPrefs).toEqual({ ...KEYS, "octave.continueWindow": "30" });
    expect(Object.keys(body.CustomPrefs)).toEqual(Object.keys(KEYS));
  });
});

describe("T9-09 item 3: only Octave's own record and keys", () => {
  it("T9-09 item 3: every request names path /DisplayPreferences/octave and client=octave only", async () => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record(KEYS));
    await gateway.accountPreferences();
    await gateway.saveAccountPreferences({ continueWindow: "365" });
    expect(transport.requests).toHaveLength(3);
    for (const request of transport.requests) {
      expect(request.url).toBe("/DisplayPreferences/octave");
      expect(request.params.client).toBe("octave");
      expect(request.query.map(([name]) => name)).toEqual(["userId", "client"]);
    }
  });

  it("T9-09 item 3: another app's keys are read and not posted back, a kept key that passes D4's patterns is", async () => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(
      GET,
      record({
        homesection0: "smalllibrarytiles",
        "landing-x": "movies",
        chromecastVersion: "stable",
        customKey: "x",
        "octave.futureSetting": "on",
        ...KEYS,
      }),
    );
    await gateway.saveAccountPreferences({ continueWindow: "30" });
    const text = JSON.stringify(transport.requests[1]?.data);
    for (const dropped of ["homesection0", "landing-x", "chromecastVersion", "customKey"]) expect(text).not.toContain(dropped);
    const body = transport.requests[1]?.data as { CustomPrefs: Record<string, string> };
    expect(Object.keys(body.CustomPrefs)).toEqual([
      "octave.futureSetting",
      "octave.continueWindow",
      "octave.autoPlay",
      "octave.autoPlayCountdown",
      "octave.skipIntro",
      "octave.skipCredits",
    ]);
    expect(body.CustomPrefs["octave.futureSetting"]).toBe("on");
  });

  it("T9-09 item 3: a token, URL or play-session id in the read record is not in the POST", async () => {
    const { gateway, transport } = await signedIn();
    const token = "f3a9c2d4e5b60718293a4b5c6d7e8f90";
    transport.responses.set(
      GET,
      record({
        [token]: "on",
        "octave.future": `https://media.example.test/Videos/x/stream?api_key=${token}`,
        "octave.session": "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
        "octave.continueWindow": token,
      }),
    );
    await gateway.saveAccountPreferences({ continueWindow: "30" });
    const text = JSON.stringify(transport.requests[1]?.data);
    expect(text).not.toContain(token);
    expect(text).not.toContain("api_key");
    expect(text).not.toContain("0a1b2c3d4e5f60718293a4b5c6d7e8f9");
  });
});

describe("T9-09 item 4: failures", () => {
  it("T9-09 item 4: a read that fails rejects", async () => {
    const { gateway, transport } = await signedIn();
    transport.failures.set(GET, new TransportError("network"));
    await expect(gateway.accountPreferences()).rejects.toBeDefined();
  });

  it.each([
    ["a transport error", (t: FakeTransport) => t.failures.set(GET, new TransportError("network"))],
    ["a 3xx answer", (t: FakeTransport) => t.statuses.set(GET, 302)],
    ["a status of 0", (t: FakeTransport) => t.statuses.set(GET, 0)],
    ["a server error", (t: FakeTransport) => t.statuses.set(GET, 500)],
  ])("T9-09 item 4: a save whose GET fails with %s rejects and sends no POST", async (_name, fail) => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record(KEYS));
    fail(transport);
    await expect(gateway.saveAccountPreferences({ continueWindow: "30" })).rejects.toBeDefined();
    expect(routes(transport)).toEqual([GET]);
  });

  it.each([
    ["no CustomPrefs", { Id: "octave" }],
    ["CustomPrefs null", record(null)],
    ["CustomPrefs a list", record([])],
    ["a null body", null],
  ])("T9-09 item 4: a save whose GET answers %s rejects and sends no POST", async (_name, body) => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, body);
    await expect(gateway.saveAccountPreferences({ continueWindow: "30" })).rejects.toBeDefined();
    expect(routes(transport)).toEqual([GET]);
  });

  it.each([
    ["a transport error", (t: FakeTransport) => t.failures.set(POST, new TransportError("network"))],
    ["a 3xx answer", (t: FakeTransport) => t.statuses.set(POST, 302)],
    ["a status of 0", (t: FakeTransport) => t.statuses.set(POST, 0)],
    ["a server error", (t: FakeTransport) => t.statuses.set(POST, 500)],
  ])("T9-09 item 4: a POST that fails with %s rejects", async (_name, fail) => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record(KEYS));
    fail(transport);
    await expect(gateway.saveAccountPreferences({ continueWindow: "30" })).rejects.toBeDefined();
    expect(routes(transport)).toEqual([GET, POST]);
  });

  it("T9-09 item 4: a failed save does not block the next one", async () => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record(KEYS));
    transport.failures.set(POST, new TransportError("network"));
    await expect(gateway.saveAccountPreferences({ continueWindow: "30" })).rejects.toBeDefined();
    transport.failures.delete(POST);
    await expect(gateway.saveAccountPreferences({ continueWindow: "365" })).resolves.toMatchObject({ continueWindow: "365" });
    expect(routes(transport)).toEqual([GET, POST, GET, POST]);
  });

  it("T9-09 item 4: saves run one at a time, each reading after the one before has posted", async () => {
    const { gateway, transport } = await signedIn();
    transport.responses.set(GET, record(KEYS));
    await Promise.all([gateway.saveAccountPreferences({ continueWindow: "30" }), gateway.saveAccountPreferences({ continueWindow: "365" })]);
    expect(routes(transport)).toEqual([GET, POST, GET, POST]);
  });
});
