import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, accountPreferencesOf, sanitizeAccountPreferences, type AccountPreferences } from "../preference-store";
import {
  ACCOUNT_PREFERENCES_RECORD,
  displayPreferencesBody,
  keptOctaveKeys,
  toAccountPreferences,
  withAccountChange,
} from "./account-preferences";

// T9-09 items 3 and 7 (docs/specs/T9-09.md D2, D4, D8): the mapping between Octave's five display preference keys
// and AccountPreferences, and the body a save builds. Pure: no transport. Fake secrets only.
const DEFAULTS = accountPreferencesOf(DEFAULT_PREFERENCES);
const dto = (customPrefs: unknown) => ({ Id: "octave", Client: "octave", CustomPrefs: customPrefs });

const ALL: AccountPreferences = {
  continueWindow: "180",
  skipModes: { intro: "auto", credits: "none" },
  autoPlay: { enabled: false, countdownSeconds: 15 },
};

describe("T9-09 item 3: reading the record passes the allowlist", () => {
  it("T9-09 item 3: the record is Octave's own", () => {
    expect(ACCOUNT_PREFERENCES_RECORD).toEqual({ id: "octave", client: "octave" });
  });

  it.each(["30", "90", "180", "365", "all"])("T9-09 item 3: octave.continueWindow %s reads as itself", (value) => {
    expect(toAccountPreferences(dto({ "octave.continueWindow": value })).continueWindow).toBe(value);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("T9-09 item 3: octave.autoPlay %s reads as %s", (text, enabled) => {
    expect(toAccountPreferences(dto({ "octave.autoPlay": text })).autoPlay.enabled).toBe(enabled);
  });

  it.each([5, 10, 15])("T9-09 item 3: octave.autoPlayCountdown %i reads as that many seconds", (seconds) => {
    expect(toAccountPreferences(dto({ "octave.autoPlayCountdown": String(seconds) })).autoPlay.countdownSeconds).toBe(seconds);
  });

  it.each(["button", "auto", "none"])("T9-09 item 3: octave.skipIntro and octave.skipCredits %s read as that mode", (mode) => {
    const read = toAccountPreferences(dto({ "octave.skipIntro": mode, "octave.skipCredits": mode }));
    expect(read.skipModes).toEqual({ intro: mode, credits: mode });
  });

  it("T9-09 item 3: an answer holding all five keys maps to the values of D2's table", () => {
    const read = toAccountPreferences(
      dto({
        "octave.continueWindow": "180",
        "octave.autoPlay": "false",
        "octave.autoPlayCountdown": "15",
        "octave.skipIntro": "auto",
        "octave.skipCredits": "none",
      }),
    );
    expect(read).toEqual(ALL);
  });

  it.each([
    ["a countdown that is not allowed", { "octave.autoPlayCountdown": "7" }],
    ["a skip mode in the wrong case", { "octave.skipIntro": "AUTO" }],
    ["a boolean that is not true or false", { "octave.autoPlay": "yes" }],
    ["a number where a string belongs", { "octave.continueWindow": 180, "octave.autoPlayCountdown": 5, "octave.autoPlay": true }],
    ["null values", { "octave.continueWindow": null, "octave.skipCredits": null }],
    ["an unknown window", { "octave.continueWindow": "45" }],
  ])("T9-09 item 3: %s falls back to each field's own default", (_name, prefs) => {
    const read = toAccountPreferences(dto(prefs));
    expect(read).toEqual(DEFAULTS);
    expect(read).toEqual(sanitizeAccountPreferences(DEFAULTS));
  });

  it("T9-09 item 3: each field falls back on its own, not the whole record", () => {
    const read = toAccountPreferences(dto({ "octave.autoPlayCountdown": "7", "octave.skipIntro": "auto", "octave.continueWindow": "30" }));
    expect(read).toEqual({ continueWindow: "30", skipModes: { intro: "auto", credits: "button" }, autoPlay: { enabled: true, countdownSeconds: 10 } });
  });

  it.each([
    ["CustomPrefs absent", { Id: "octave" }],
    ["CustomPrefs null", dto(null)],
    ["CustomPrefs a list", dto(["octave.continueWindow", "30"])],
    ["CustomPrefs a string", dto("octave.continueWindow=30")],
    ["no DTO at all (undefined)", undefined],
    ["no DTO at all (null)", null],
    ["a string DTO", "oops"],
  ])("T9-09 item 3: %s gives the defaults", (_name, value) => {
    expect(toAccountPreferences(value)).toEqual(DEFAULTS);
  });

  it("T9-09 item 3: unknown keys and typed fields are not in the result", () => {
    const read = toAccountPreferences({ ...dto({ "octave.future": "on", customKey: "x", "octave.skipIntro": "none" }), SortBy: "SortName", Token: "x" });
    expect(Object.keys(read).sort()).toEqual(["autoPlay", "continueWindow", "skipModes"]);
    expect(JSON.stringify(read)).not.toContain("future");
    expect(JSON.stringify(read)).not.toContain("customKey");
  });
});

describe("T9-09 item 3: the kept keys", () => {
  it("T9-09 item 3: keeps an octave. key that is not one of D2's and fits both patterns", () => {
    expect(keptOctaveKeys(dto({ "octave.futureSetting": "on", "octave.n1": "A1b2" }))).toEqual({ "octave.futureSetting": "on", "octave.n1": "A1b2" });
  });

  it.each([
    ["one of D2's keys", { "octave.continueWindow": "30", "octave.autoPlay": "true", "octave.autoPlayCountdown": "5", "octave.skipIntro": "auto", "octave.skipCredits": "none" }],
    ["another app's key", { chromecastVersion: "stable", homesection0: "smalllibrarytiles", "landing-x": "movies", customKey: "x", skipForwardLength: "30000" }],
    ["a key that starts with a digit after the prefix", { "octave.1abc": "on" }],
    ["a key with a dash", { "octave.future-setting": "on" }],
    ["a key of 33 characters after the prefix", { [`octave.a${"b".repeat(32)}`]: "on" }],
    ["a value with a colon", { "octave.future": "a:b" }],
    ["a value with a slash", { "octave.future": "a/b" }],
    ["a value of 17 characters", { "octave.future": "a".repeat(17) }],
    ["an empty value", { "octave.future": "" }],
    ["a null value", { "octave.future": null }],
    ["a number value", { "octave.future": 1 }],
    ["an upper-case prefix", { "Octave.future": "on" }],
  ])("T9-09 item 3: drops %s", (_name, prefs) => {
    expect(keptOctaveKeys(dto(prefs))).toEqual({});
  });

  it("T9-09 item 3: keeps a value of exactly 16 characters and a key of exactly 32 after the prefix", () => {
    const key = `octave.a${"b".repeat(31)}`;
    expect(keptOctaveKeys(dto({ [key]: "a".repeat(16) }))).toEqual({ [key]: "a".repeat(16) });
  });

  it.each([[undefined], [null], [dto(null)], [dto([])], ["x"]])("T9-09 item 3: %j keeps nothing", (value) => {
    expect(keptOctaveKeys(value)).toEqual({});
  });
});

describe("T9-09 item 3: the body is built, never echoed", () => {
  it("T9-09 item 3: holds D4's fields in D4's order with CustomPrefs last, the kept keys before D2's five keys in the table's order", () => {
    const body = displayPreferencesBody(ALL, { "octave.futureSetting": "on" });
    expect(JSON.stringify(body)).toBe(
      '{"Id":"octave","Client":"octave","SortBy":"SortName","SortOrder":"Ascending","RememberIndexing":false,"RememberSorting":false,' +
        '"ScrollDirection":"Horizontal","ShowBackdrop":true,"ShowSidebar":false,"PrimaryImageHeight":250,"PrimaryImageWidth":250,' +
        '"CustomPrefs":{"octave.futureSetting":"on","octave.continueWindow":"180","octave.autoPlay":"false","octave.autoPlayCountdown":"15",' +
        '"octave.skipIntro":"auto","octave.skipCredits":"none"}}',
    );
  });

  it("T9-09 item 3: R1's golden case builds exactly the recorded body text", () => {
    const read = {
      Id: "golden-display-preferences-id",
      Client: "octave",
      SortBy: "SortName",
      CustomPrefs: { chromecastVersion: "stable", "octave.continueWindow": "180", "octave.skipIntro": "auto" },
    };
    const next = withAccountChange(toAccountPreferences(read), { autoPlay: { enabled: false, countdownSeconds: 5 } });
    expect(JSON.stringify(displayPreferencesBody(next, keptOctaveKeys(read)))).toBe(
      '{"Id":"octave","Client":"octave","SortBy":"SortName","SortOrder":"Ascending","RememberIndexing":false,"RememberSorting":false,"ScrollDirection":"Horizontal","ShowBackdrop":true,"ShowSidebar":false,"PrimaryImageHeight":250,"PrimaryImageWidth":250,"CustomPrefs":{"octave.continueWindow":"180","octave.autoPlay":"false","octave.autoPlayCountdown":"5","octave.skipIntro":"auto","octave.skipCredits":"button"}}',
    );
  });

  it("T9-09 item 3: writes only sanitized values, so a bad value is written as its default", () => {
    const body = displayPreferencesBody({ continueWindow: "45", skipModes: { intro: "x", credits: "none" }, autoPlay: { enabled: true, countdownSeconds: 7 } } as never, {});
    expect(body.CustomPrefs).toEqual({
      "octave.continueWindow": "90",
      "octave.autoPlay": "true",
      "octave.autoPlayCountdown": "10",
      "octave.skipIntro": "button",
      "octave.skipCredits": "none",
    });
  });

  it("T9-09 item 3: withAccountChange changes only the given fields, through the allowlist", () => {
    expect(withAccountChange(ALL, { continueWindow: "30" })).toEqual({ ...ALL, continueWindow: "30" });
    expect(withAccountChange(ALL, { continueWindow: "14" as never }).continueWindow).toBe("90");
    expect(withAccountChange(ALL, {})).toEqual(ALL);
  });
});

const TOKEN = "f3a9c2d4e5b60718293a4b5c6d7e8f90";
const SECRETS: [string, string][] = [
  ["a 32-hex token", TOKEN],
  ["an authorization value", `MediaBrowser Client="Octave", Device="tv", DeviceId="d1", Version="1", Token="${TOKEN}"`],
  ["an authenticated URL", `https://media.example.test/Videos/x/stream?api_key=${TOKEN}`],
  ["a play-session id", "0a1b2c3d4e5f60718293a4b5c6d7e8f9"],
  ["the token's SHA-256 hex", createHash("sha256").update(TOKEN).digest("hex")],
];

describe.each(SECRETS)("T9-09 item 3: %s read from the record is never written back", (_name, secret) => {
  const placements: [string, (secret: string) => unknown][] = [
    ["as a CustomPrefs key", (s) => dto({ [s]: "on" })],
    ["as the value of an unprefixed key", (s) => dto({ other: s })],
    ["as the value of each Octave key", (s) => dto({ "octave.continueWindow": s, "octave.autoPlay": s, "octave.autoPlayCountdown": s, "octave.skipIntro": s, "octave.skipCredits": s })],
    ["as the value of an octave.-prefixed unknown key", (s) => dto({ "octave.future": s, "octave.other": "on" })],
    ["as a top-level field", (s) => ({ ...dto({}), Token: s, Id: s, Client: s })],
    ["as a nested value", (s) => ({ ...dto({}), Nested: { deep: [{ value: s }] }, CustomPrefs: { "octave.future": { inner: s } } })],
  ];
  it.each(placements)("T9-09 item 3: %s", (_placement, make) => {
    const read = make(secret);
    const body = displayPreferencesBody(withAccountChange(toAccountPreferences(read), {}), keptOctaveKeys(read));
    const text = JSON.stringify(body);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(encodeURIComponent(secret));
    expect(encodeURIComponent(text)).not.toContain(encodeURIComponent(secret));
  });
});

describe("T9-09 item 7: a window left from before the owner's values reads as 90", () => {
  it.each(["7", "14"])("T9-09 item 7: octave.continueWindow %s reads as 90", (value) => {
    expect(toAccountPreferences(dto({ "octave.continueWindow": value })).continueWindow).toBe("90");
  });

  it.each(["7", "14"])("T9-09 item 7: the save body built after reading %s writes octave.continueWindow 90", (value) => {
    const read = dto({ "octave.continueWindow": value, "octave.skipIntro": "auto" });
    const next = withAccountChange(toAccountPreferences(read), { autoPlay: { enabled: false, countdownSeconds: 5 } });
    const body = displayPreferencesBody(next, keptOctaveKeys(read));
    expect(body.CustomPrefs["octave.continueWindow"]).toBe("90");
    expect(JSON.stringify(body)).not.toContain(`"octave.continueWindow":"${value}"`);
  });
});
