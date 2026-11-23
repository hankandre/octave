import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import { loadHome } from "../domain/home";
import { FakeClock } from "../ports/fake-clock";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";

// T5-07 items 1, 4 and 5: loadHome on the real gateway over a fake transport, with the time from a FakeClock.
// Never the wall clock: the clock is set to a fixed date, and moves only through advance.
const DAY = 86_400_000;
const START = Date.parse("2026-11-22T12:00:00Z");
const ago = (days: number, from = START) => new Date(from - days * DAY).toISOString();

const film = (id: string, lastPlayedAt: string) => ({
  Id: id, Name: `Film ${id}`, Type: "Movie", RunTimeTicks: 1_000_000_000,
  UserData: { PlaybackPositionTicks: 100_000_000, Played: false, LastPlayedDate: lastPlayedAt },
});
const latestFilm = { Id: "new-1", Name: "New film", Type: "Movie", UserData: { PlaybackPositionTicks: 0, Played: false } };

const RESUME = "GET /UserItems/Resume";
const NEXT_UP = "GET /Shows/NextUp";
const PLAYED = "GET /Items";
const LATEST = "GET /Items/Latest";

async function signedIn(resume: unknown[]) {
  const transport = new FakeTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "token-1", User: { Id: "user-1", Name: "Louise" } });
  transport.responses.set(RESUME, { Items: resume });
  transport.responses.set(NEXT_UP, { Items: [] });
  transport.responses.set(PLAYED, { Items: [] });
  transport.responses.set(LATEST, [latestFilm]);
  const gateway = new JellyfinGateway("https://media.test", webCrypto, transport, "install-1");
  await gateway.login("Louise", "password");
  return { gateway, transport };
}

const key = (request: { method: string; url: string }) => `${request.method} ${request.url}`;
const paramsOf = (transport: FakeTransport, route: string) => transport.requests.find((request) => key(request) === route)?.params ?? {};
const whole = (home: Awaited<ReturnType<typeof loadHome>>["home"]) =>
  home.hero.rule === "row" ? [home.hero.card.id, ...home.continueWatching.map((card) => card.id)] : home.continueWatching.map((card) => card.id);

describe("loadHome, the window and the clock", () => {
  it("T5-07 item 1: ages the Resume answer by the clock's time, and by nothing else", async () => {
    const { gateway } = await signedIn([film("in", ago(89)), film("out", ago(91))]);
    const clock = new FakeClock(START);
    const { home, failed } = await loadHome(gateway, { window: "90", clock });
    expect(failed).toEqual([]);
    expect(whole(home)).toEqual(["in"]);
  });

  it("T5-07 item 1: ages a title out once the clock has advanced past the window, on the next load", async () => {
    const { gateway } = await signedIn([film("a", ago(89)), film("b", ago(10))]);
    const clock = new FakeClock(START);
    expect(whole((await loadHome(gateway, { window: "90", clock })).home)).toEqual(["b", "a"]);
    await clock.advance(2 * DAY);
    expect(whole((await loadHome(gateway, { window: "90", clock })).home)).toEqual(["b"]);
  });

  it("T5-07 item 1: reads the window as 90 days when none is given", async () => {
    const { gateway } = await signedIn([film("in", ago(89)), film("out", ago(91))]);
    const { home } = await loadHome(gateway, { clock: new FakeClock(START) });
    expect(whole(home)).toEqual(["in"]);
  });

  it("T5-07 item 1: asks Resume and recently played for UserData, and sends only GET requests to no write route", async () => {
    const { gateway, transport } = await signedIn([film("in", ago(1))]);
    await loadHome(gateway, { window: "90", clock: new FakeClock(START) });
    expect(paramsOf(transport, RESUME).enableUserData).toBe("true");
    expect(paramsOf(transport, PLAYED).enableUserData).toBe("true");
    expect(transport.requests.length).toBeGreaterThan(0);
    expect(transport.requests.every((request) => request.method === "GET")).toBe(true);
    expect(transport.requests.some((request) => /UserData|UserPlayedItems|hide/i.test(request.url))).toBe(false);
  });

  it("T5-07 item 4: sends only GET requests for an aged-out title, and shows it first when it is played again", async () => {
    const { gateway, transport } = await signedIn([film("replayed", ago(120)), film("other", ago(3))]);
    const clock = new FakeClock(START);
    const first = await loadHome(gateway, { window: "90", clock });
    expect(whole(first.home)).toEqual(["other"]);
    expect(transport.requests.every((request) => request.method === "GET")).toBe(true);
    // Played again on another device: the same clock time, a newer LastPlayedDate.
    transport.responses.set(RESUME, { Items: [film("replayed", ago(1)), film("other", ago(3))] });
    const second = await loadHome(gateway, { window: "90", clock });
    expect(second.home.hero).toMatchObject({ rule: "row", card: { id: "replayed" } });
    expect(whole(second.home)).toEqual(["replayed", "other"]);
    expect(transport.requests.every((request) => request.method === "GET")).toBe(true);
  });
});

describe("loadHome, the limits", () => {
  it("T5-07 item 5: asks Resume and Next Up for 20 and recently played for 100", async () => {
    const { gateway, transport } = await signedIn([film("a", ago(1))]);
    await loadHome(gateway, { window: "90", clock: new FakeClock(START) });
    expect(paramsOf(transport, RESUME).limit).toBe("20");
    expect(paramsOf(transport, NEXT_UP).limit).toBe("20");
    expect(paramsOf(transport, PLAYED).limit).toBe("100");
  });

  it("T5-07 item 5: still sends 16 when resumeItems and nextUp are called with no limit", async () => {
    const { gateway, transport } = await signedIn([film("a", ago(1))]);
    await gateway.resumeItems();
    await gateway.nextUp();
    expect(paramsOf(transport, RESUME).limit).toBe("16");
    expect(paramsOf(transport, NEXT_UP).limit).toBe("16");
  });

  it("T5-07 item 5: shows at most 20 titles from a Resume answer of 24, 19 beneath the hero", async () => {
    const resume = Array.from({ length: 24 }, (_, index) => film(`f${index}`, ago(index + 1)));
    const { gateway } = await signedIn(resume);
    const { home } = await loadHome(gateway, { window: "all", clock: new FakeClock(START) });
    expect(whole(home)).toEqual(Array.from({ length: 20 }, (_, index) => `f${index}`));
    expect(home.continueWatching).toHaveLength(19);
  });
});
