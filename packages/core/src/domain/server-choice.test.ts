// T4-02 items 3, 6, 7, 8 and 12, the pure half (docs/specs/T4-02.md, D3, D7, R8, R11): which code each failure gets,
// how a typed address with no scheme is completed, and the order of the rows.
import { describe, expect, it } from "vitest";
import { TransportError, type TransportErrorCode } from "../ports/transport";
import type { DiscoveredServer } from "./server-discovery";
import { completeAddress, listServers, serverChoiceFailure } from "./server-choice";
import { SignInFailure, type SignInFailureKind } from "./sign-in-failure";

const HTTPS = "https://media.example.test";
const HTTP = "http://nas.local:8096";
const ID_ONE = "0123456789abcdef0123456789abcdef";
const ID_TWO = "fedcba9876543210fedcba9876543210";
const ID_THREE = "00112233445566778899aabbccddeeff";

const transport = (code: TransportErrorCode, status?: number) => new TransportError(code, status);
const signIn = (kind: SignInFailureKind) => new SignInFailure(kind, "A fixed sentence.");

describe("T4-02 item 3: a typed address with no scheme", () => {
  it.each([
    ["192.168.1.5:8096", "http://192.168.1.5:8096"],
    ["nas.local:8096", "http://nas.local:8096"],
    ["localhost:8096", "http://localhost:8096"],
    ["127.0.0.1", "http://127.0.0.1"],
    ["  192.168.1.5:8096  ", "http://192.168.1.5:8096"],
    ["media.example.com", "https://media.example.com"],
    ["media.example.com/jellyfin", "https://media.example.com/jellyfin"],
    ["nas", "https://nas"],
    ["8.8.8.8:8096", "https://8.8.8.8:8096"],
    ["bücher.example", "https://bücher.example"],
  ])("T4-02 item 3: completes %j as %j", (typed, completed) => {
    expect(completeAddress(typed)).toBe(completed);
  });

  it.each(["https://192.168.1.5:8920", "http://media.example.com", "HTTP://NAS.local:8096", "ftp://nas.local"])(
    "T4-02 item 3: leaves %j, which has a scheme, untouched",
    (typed) => {
      expect(completeAddress(typed)).toBe(typed);
    },
  );
});

describe("T4-02 item 6: every failure has one code", () => {
  it.each([
    ["a network failure", transport("network"), HTTPS, "unreachable"],
    ["a network failure on plain HTTP", transport("network"), HTTP, "unreachable"],
    ["a timeout", transport("timeout"), HTTPS, "unreachable"],
    ["a 404", transport("status", 404), HTTPS, "other"],
    ["a 503", transport("status", 503), HTTPS, "other"],
    ["a 503 on plain HTTP", transport("status", 503), HTTP, "other"],
    ["a refusal on plain HTTP", transport("refused"), HTTP, "refused-plain-http"],
    ["a refusal on https", transport("refused"), HTTPS, "other"],
    ["an unusable answer", transport("unexpected-response"), HTTPS, "other"],
    ["an invalid address", signIn("invalid-address"), HTTPS, "not-an-address"],
    ["public plain HTTP", signIn("public-http"), "http://media.example.com", "refused-plain-http"],
    ["a Unicode host", signIn("unicode-host"), "https://bücher.example", "unicode-host"],
    ["a redirect", signIn("redirect"), HTTPS, "redirect"],
    ["an unsupported version", signIn("unsupported-version"), HTTPS, "unsupported-version"],
    ["an unexpected response", signIn("unexpected-response"), HTTPS, "other"],
    ["an unconfirmed connection", signIn("not-confirmed"), HTTP, "other"],
    ["a plain error", new Error("The install id is not available."), HTTPS, "other"],
    ["a thrown string", "boom", HTTPS, "other"],
    ["nothing at all", undefined, HTTPS, "other"],
  ])("T4-02 item 6: %s", (_name, error, address, code) => {
    expect(serverChoiceFailure(error, address)).toBe(code);
  });

  it.each([HTTPS, HTTP])("T4-02 item 6: a cancellation on %s has no code, so nothing is shown", (address) => {
    expect(serverChoiceFailure(transport("cancelled"), address)).toBeUndefined();
  });

  it("T4-02 item 6: reads the code and never the message", () => {
    const misleading = Object.assign(new Error("refused redirect timeout unsupported-version"), { name: "TransportError" });
    expect(serverChoiceFailure(misleading, HTTP)).toBe("other");
    const worded = Object.assign(new Error("a redirect"), { code: "network" });
    expect(serverChoiceFailure(worded, HTTPS)).toBe("unreachable");
  });
});

describe("T4-02 item 7: remembered servers come first", () => {
  const found = (id: string, address: string, name: string): DiscoveredServer => ({
    name,
    id,
    address,
    advertisedBy: "192.168.1.5",
    addressIsSender: true,
    conflicting: false,
  });
  const remembered = [
    { id: ID_TWO, name: "Second", address: "https://second.example.test" },
    { id: ID_ONE, name: "First", address: "https://first.example.test" },
  ];

  it("T4-02 item 7: lists the remembered rows in their order, then the found ones in theirs", () => {
    const rows = listServers(remembered, [found(ID_THREE, "http://192.168.1.7:8096", "Third")]);
    expect(rows.map((row) => row.address)).toEqual(["https://second.example.test", "https://first.example.test", "http://192.168.1.7:8096"]);
    expect(rows.map((row) => row.name)).toEqual(["Second", "First", "Third"]);
  });

  it("T4-02 item 7: drops a found row with a remembered id, whatever its case, dashes or address", () => {
    const dashed = "01234567-89AB-CDEF-0123-456789ABCDEF";
    const rows = listServers(remembered, [found(dashed, "http://192.168.1.5:8096", "First on the LAN"), found(ID_THREE, "http://192.168.1.7:8096", "Third")]);
    expect(rows.map((row) => row.address)).toEqual(["https://second.example.test", "https://first.example.test", "http://192.168.1.7:8096"]);
  });

  it("T4-02 item 7: with nothing remembered, lists every found server", () => {
    const rows = listServers([], [found(ID_ONE, "http://192.168.1.5:8096", "One"), found(ID_THREE, "http://192.168.1.7:8096", "Three")]);
    expect(rows.map((row) => row.address)).toEqual(["http://192.168.1.5:8096", "http://192.168.1.7:8096"]);
  });
});

describe("T4-02 item 8: a native refusal of an xn-- host is not an address", () => {
  it.each(["https://xn--a.example", "https://media.XN--bcher-kva.example", "HTTPS://Xn--zz-.example:8920/jellyfin"])(
    "T4-02 item 8: refused for %s gives not-an-address",
    (address) => {
      expect(serverChoiceFailure(transport("refused"), address)).toBe("not-an-address");
    },
  );

  it.each([
    ["https://media.example.test", "no xn-- label"],
    ["https://media.example.test/xn--a", "xn-- only in the path"],
    ["https://myxn--a.example", "a label that only contains xn--"],
  ])("T4-02 item 8: refused for %s (%s) stays other", (address) => {
    expect(serverChoiceFailure(transport("refused"), address)).toBe("other");
  });

  it("T4-02 item 8: an unreachable xn-- host is still unreachable", () => {
    expect(serverChoiceFailure(transport("network"), "https://xn--a.example")).toBe("unreachable");
  });
});

describe("T4-02 item 12: a refused plain-HTTP name shows the plain-HTTP refusal", () => {
  it("T4-02 item 12: refused for http://nas.local:8096 gives refused-plain-http, the code of a public plain-HTTP address", () => {
    expect(serverChoiceFailure(transport("refused"), HTTP)).toBe("refused-plain-http");
    expect(serverChoiceFailure(signIn("public-http"), "http://media.example.com")).toBe("refused-plain-http");
  });

  it("T4-02 item 12: the scheme is read in any case", () => {
    expect(serverChoiceFailure(transport("refused"), "HTTP://nas.local:8096")).toBe("refused-plain-http");
  });

  it("T4-02 item 12: refused for https://media.example.test gives other", () => {
    expect(serverChoiceFailure(transport("refused"), "https://media.example.test")).toBe("other");
  });
});
