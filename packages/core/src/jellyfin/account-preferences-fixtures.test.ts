import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import { DEFAULT_PREFERENCES, accountPreferencesOf, type AccountPreferences } from "../preference-store";
import { displayPreferencesBody, keptOctaveKeys, toAccountPreferences, withAccountChange } from "./account-preferences";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";

// T9-09 item 6 (docs/specs/T9-09.md, "Recorded answers"): the answers recorded by
// tests/integration/record-display-preferences-fixtures.mjs on Jellyfin 10.11.7, Jellyfin 12.4.0 and the pinned
// Jellyscale, replayed through the core. A missing file fails the test; it never skips.
interface Step {
  step: string;
  device: "A" | "B";
  request: { method: string; path: string; query: Record<string, string>; body?: unknown };
  status: number;
  body: unknown;
}
const fixtureRoot = join(__dirname, "../../tests/fixtures");

function load(dir: string): Step[] {
  const file = join(fixtureRoot, dir, "display-preferences.json");
  expect(existsSync(file), `${file} is missing`).toBe(true);
  return (JSON.parse(readFileSync(file, "utf8")) as { steps: Step[] }).steps;
}

const WRITTEN: AccountPreferences = {
  continueWindow: "180",
  skipModes: { intro: "auto", credits: "none" },
  autoPlay: { enabled: false, countdownSeconds: 15 },
};
const DEFAULTS = accountPreferencesOf(DEFAULT_PREFERENCES);

describe.each([
  ["jellyfin/10.11.7", "jellyfin/10.11.7"],
  ["jellyfin/12.4.0", "jellyfin/12.4.0"],
  ["jellyscale/b920b193cd6f", "jellyscale/b920b193cd6f"],
] as const)("T9-09 item 6: %s", (_name, dir) => {
  const steps = () => load(dir);
  const at = (name: string) => {
    const found = steps().find((step) => step.step === name);
    expect(found, `step ${name} is recorded`).toBeDefined();
    return found as Step;
  };

  it("T9-09 item 6: records the eight steps S0 to S7, every answer 2xx", () => {
    expect(steps().map((step) => step.step)).toEqual(["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
    for (const step of steps()) expect(step.status, step.step).toBeGreaterThanOrEqual(200);
    for (const step of steps()) expect(step.status, step.step).toBeLessThan(300);
  });

  it("T9-09 item 6: the recorded requests are the gateway's: path, query names and order, devices A and B", () => {
    for (const step of steps()) {
      const other = step.step === "S0" || step.step === "S7";
      expect(step.request.path, step.step).toBe(other ? "/DisplayPreferences/usersettings" : "/DisplayPreferences/octave");
      expect(Object.keys(step.request.query), step.step).toEqual(["userId", "client"]);
      expect(step.request.query.client, step.step).toBe(other ? "emby" : "octave");
      expect(step.request.method, step.step).toBe(step.step === "S2" || step.step === "S5" ? "POST" : "GET");
    }
    expect(steps().map((step) => step.device)).toEqual(["A", "A", "A", "A", "B", "B", "A", "A"]);
  });

  it("T9-09 item 6: S1 gives the defaults and holds no octave. key", () => {
    const body = at("S1").body as { CustomPrefs: Record<string, unknown> };
    expect(Object.keys(body.CustomPrefs).filter((key) => key.startsWith("octave."))).toEqual([]);
    expect(toAccountPreferences(body)).toEqual(DEFAULTS);
  });

  it("T9-09 item 6: S2's body is the body displayPreferencesBody builds for the written values and a kept key", () => {
    const request = at("S2").request.body;
    expect(JSON.stringify(request)).toBe(JSON.stringify(displayPreferencesBody(WRITTEN, { "octave.futureSetting": "on" })));
  });

  it("T9-09 item 6: S3 (device A) and S4 (device B) read the values written at S2, and the kept key", () => {
    for (const name of ["S3", "S4"]) {
      const body = at(name).body;
      expect(toAccountPreferences(body), name).toEqual(WRITTEN);
      expect(keptOctaveKeys(body), name).toEqual({ "octave.futureSetting": "on" });
    }
  });

  it("T9-09 item 6: S5's body is the body for window 30 and the rest as device B read it", () => {
    const next = withAccountChange(toAccountPreferences(at("S4").body), { continueWindow: "30" });
    expect(JSON.stringify(at("S5").request.body)).toBe(JSON.stringify(displayPreferencesBody(next, keptOctaveKeys(at("S4").body))));
  });

  it("T9-09 item 6: S6 reads the values written at S5, on device A", () => {
    expect(toAccountPreferences(at("S6").body)).toEqual({ ...WRITTEN, continueWindow: "30" });
    expect(keptOctaveKeys(at("S6").body)).toEqual({ "octave.futureSetting": "on" });
  });

  it("T9-09 item 6: another app's record is equal at S0 and S7", () => {
    expect(at("S7").body).toEqual(at("S0").body);
  });

  it("T9-09 item 6: the gateway reads each recorded answer as the table says", async () => {
    const transport = new FakeTransport();
    transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "token-1", User: { Id: "user-1", Name: "Louise" } });
    const gateway = new JellyfinGateway("https://media.test", webCrypto, transport, "install-1");
    await gateway.login("Louise", "password");
    const expected: [string, AccountPreferences][] = [
      ["S1", DEFAULTS],
      ["S3", WRITTEN],
      ["S4", WRITTEN],
      ["S6", { ...WRITTEN, continueWindow: "30" }],
    ];
    for (const [name, values] of expected) {
      transport.responses.set("GET /DisplayPreferences/octave", at(name).body);
      await expect(gateway.accountPreferences(), name).resolves.toEqual(values);
    }
  });

  it("T9-09 item 6: a save through the gateway on the recorded S4 answer posts exactly what device B posted at S5", async () => {
    const transport = new FakeTransport();
    transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "token-1", User: { Id: "user-1", Name: "Louise" } });
    const gateway = new JellyfinGateway("https://media.test", webCrypto, transport, "install-1");
    await gateway.login("Louise", "password");
    transport.requests = [];
    transport.responses.set("GET /DisplayPreferences/octave", at("S4").body);
    await gateway.saveAccountPreferences({ continueWindow: "30" });
    expect(JSON.stringify(transport.requests[1]?.data)).toBe(JSON.stringify(at("S5").request.body));
  });
});
