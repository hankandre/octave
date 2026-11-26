// T4-03 (docs/specs/T4-03.md, D4, D5, D6): the pure rules of Quick Connect sign-in. The approval link a QR code carries,
// when there is none, how the code is shown and read, and which failure each answer is.
//
// Testing contract (the implementer builds to it)
// - `quickConnectFailure(error, step)` takes `step` as "enabled" | "initiate" | "connect" | "sign-in" and answers a
//   QuickConnectFailure, or undefined for a cancellation. The `unavailable` rows of D4 are the run's
//   (jellyfin/quick-connect-sign-in.test.ts), not this table's.
import { describe, expect, it } from "vitest";
import { TransportError } from "../ports/transport";
import { SignInFailure } from "./sign-in-failure";
import { groupCode, quickConnectApprovalLink, quickConnectFailure, spokenCode } from "./quick-connect";

describe("T4-03 item 2: the approval link", () => {
  it("T4-03 item 2: keeps the server's base path and names the code on jellyfin-web's Quick Connect route", () => {
    expect(quickConnectApprovalLink({ serverUrl: "https://media.example.test:8920/jellyfin", hostClass: "public" }, "482913")).toBe(
      "https://media.example.test:8920/jellyfin/web/#/quickconnect?code=482913",
    );
    expect(quickConnectApprovalLink({ serverUrl: "http://192.168.1.5:8096", hostClass: "private-lan" }, "482913")).toBe(
      "http://192.168.1.5:8096/web/#/quickconnect?code=482913",
    );
  });

  it("T4-03 item 2: a code that is not digits is encoded, so it cannot add a parameter or a fragment", () => {
    expect(quickConnectApprovalLink({ serverUrl: "https://media.example.test", hostClass: "public" }, "48 &#=13")).toBe(
      "https://media.example.test/web/#/quickconnect?code=48%20%26%23%3D13",
    );
  });
});

describe("T4-03 item 6: a server a phone cannot open gives no approval link", () => {
  it.each(["http://127.0.0.1:8096", "http://localhost:8096"])("T4-03 item 6: %s gives no link", (serverUrl) => {
    expect(quickConnectApprovalLink({ serverUrl, hostClass: "loopback" }, "482913")).toBeUndefined();
  });

  it.each([
    ["http://192.168.1.5:8096", "private-lan"],
    ["https://media.example.test", "public"],
  ] as const)("T4-03 item 6: %s gives a link", (serverUrl, hostClass) => {
    expect(quickConnectApprovalLink({ serverUrl, hostClass }, "482913")).toBe(`${serverUrl}/web/#/quickconnect?code=482913`);
  });
});

describe("T4-03 item 1: how the code is shown", () => {
  it("T4-03 item 1: six digits are grouped three and three, and read digit by digit", () => {
    expect(groupCode("482913")).toBe("482 913");
    expect(spokenCode("482913")).toBe("4 8 2 9 1 3");
  });

  it.each(["48291", "4829130", "ABC123"])("T4-03 item 1: %s, which is not six digits, is shown as given", (code) => {
    expect(groupCode(code)).toBe(code);
  });
});

const STEPS = ["connect", "sign-in"] as const;
const ANY_STEP = ["enabled", "initiate", "connect", "sign-in"] as const;

describe("T4-03 item 4: which failure an answer is", () => {
  it.each(STEPS)("T4-03 item 4: a 404 on %s means the code expired", (step) => {
    expect(quickConnectFailure(new TransportError("status", 404), step)).toBe("expired");
  });

  it.each(STEPS.flatMap((step) => [401, 403].map((status) => [step, status] as const)))("T4-03 item 4: on %s a %s means the server refused the code", (step, status) => {
    expect(quickConnectFailure(new TransportError("status", status), step)).toBe("refused");
  });

  it.each(ANY_STEP.flatMap((step) => (["network", "timeout"] as const).map((code) => [step, code] as const)))(
    "T4-03 item 4: on %s a %s failure means the server is unreachable",
    (step, code) => {
      expect(quickConnectFailure(new TransportError(code), step)).toBe("unreachable");
    },
  );

  it.each(ANY_STEP)("T4-03 item 4: on %s a refused redirect is a redirect, from the gateway or the transport", (step) => {
    expect(quickConnectFailure(new SignInFailure("redirect", "fixed"), step)).toBe("redirect");
    expect(quickConnectFailure(new TransportError("redirect"), step)).toBe("redirect");
  });

  it.each(ANY_STEP)("T4-03 item 4: on %s a cancellation is no failure", (step) => {
    expect(quickConnectFailure(new TransportError("cancelled"), step)).toBeUndefined();
    expect(quickConnectFailure(Object.assign(new Error("stopped"), { name: "AbortError" }), step)).toBeUndefined();
  });

  it.each([
    ["a 500", new TransportError("status", 500)],
    ["an unexpected response", new TransportError("unexpected-response")],
    ["a refusal before sending", new TransportError("refused")],
    ["an unconfirmed connection", new SignInFailure("not-confirmed", "fixed")],
    ["a sign-in answer without a session", new SignInFailure("unexpected-response", "fixed")],
    ["an unknown error", new Error("boom")],
  ])("T4-03 item 4: %s is any other failure", (_name, error) => {
    expect(quickConnectFailure(error, "connect")).toBe("other");
  });

  it("T4-03 item 4: reads the code and status of a redacted error and never its message", () => {
    const redacted = Object.assign(new Error("404 expired network timeout redirect"), { code: "status", status: 500 });
    expect(quickConnectFailure(redacted, "connect")).toBe("other");
  });
});
