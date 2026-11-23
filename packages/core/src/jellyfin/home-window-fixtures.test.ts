import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import { loadHome } from "../domain/home";
import { FakeClock } from "../ports/fake-clock";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";

// T5-07 item 6: the window and the cap on the T5-02 recordings of Jellyfin 10.11.7, 12.4.0 and Jellyscale. The
// recordings are read, never changed; every date below comes from the files. The helpers are copied from
// home-fixtures.test.ts on purpose.
const fixturesRoot = join(__dirname, "../../tests/fixtures");
const composePath = join(__dirname, "../../../../tests/integration/docker-compose.yml");
const ORIGIN = "http://127.0.0.1:8096";
const DAY = 86_400_000;

function pinFolder(): string {
  const sha = /^x-jellyscale-commit:\s*([0-9a-f]{40})\b/m.exec(readFileSync(composePath, "utf8"))?.[1];
  if (!sha) throw new Error("docker-compose.yml has no x-jellyscale-commit of 40 hex characters");
  return sha.slice(0, 12);
}

interface Server {
  label: string;
  dir: string;
}

const JELLYFIN: Server[] = [
  { label: "Jellyfin 10.11.7", dir: join(fixturesRoot, "jellyfin", "10.11.7") },
  { label: "Jellyfin 12.4.0", dir: join(fixturesRoot, "jellyfin", "12.4.0") },
];
const JELLYSCALE: Server = { label: "Jellyscale", dir: join(fixturesRoot, "jellyscale", pinFolder()) };

const load = (server: Server, file: string): any => JSON.parse(readFileSync(join(server.dir, file), "utf8"));
const when = (iso: string) => Date.parse(iso);

const ROUTES = { latest: "GET /Items/Latest", resume: "GET /UserItems/Resume", nextUp: "GET /Shows/NextUp", recentlyPlayed: "GET /Items" } as const;
const FILES: Record<keyof typeof ROUTES, string> = { latest: "home-latest.json", resume: "home-resume.json", nextUp: "home-nextup.json", recentlyPlayed: "home-recently-played.json" };

async function replay(server: Server) {
  const transport = new FakeTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "REDACTED", User: { Id: "user-test", Name: "octave-test" } });
  for (const name of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) transport.responses.set(ROUTES[name], load(server, FILES[name]));
  const gateway = new JellyfinGateway(ORIGIN, webCrypto, transport, "install-1");
  await gateway.login("octave-test", "not-a-real-password");
  return gateway;
}

type Options = { window?: "30" | "90" | "180" | "365" | "all" };
async function homeAt(server: Server, now: number, options: Options = {}) {
  const gateway = await replay(server);
  const { home, failed } = await loadHome(gateway, { ...options, clock: new FakeClock(now) });
  expect(failed).toEqual([]);
  const whole = home.hero.rule === "row" ? [home.hero.card.id, ...home.continueWatching.map((card) => card.id)] : home.continueWatching.map((card) => card.id);
  return { home, whole, gateway };
}

describe.each(JELLYFIN)("Home window recordings, $label", (server) => {
  const resume: { Id: string; UserData: { LastPlayedDate: string } }[] = load(server, "home-resume.json").Items;
  const films = [...resume].sort((a, b) => when(b.UserData.LastPlayedDate) - when(a.UserData.LastPlayedDate));
  const newer = films[0]!;
  const older = films[1]!;
  const episode = load(server, "home-nextup.json").Items[0] as { Id: string; DateCreated: string };
  const seriesPlay = when(load(server, "home-recently-played.json").Items[0].UserData.LastPlayedDate);
  const arrived = when(episode.DateCreated);

  it("T5-07 item 6: every recorded Resume item carries UserData.LastPlayedDate", () => {
    expect(resume).toHaveLength(2);
    for (const item of resume) expect(Number.isNaN(when(item.UserData.LastPlayedDate))).toBe(false);
  });

  it("T5-07 item 6: at the newer film's play plus 90 days, drops the older film and keeps the newer one and the next episode", async () => {
    const { whole } = await homeAt(server, when(newer.UserData.LastPlayedDate) + 90 * DAY, { window: "90" });
    expect(whole).toEqual([episode.Id, newer.Id]);
    expect(whole).not.toContain(older.Id);
  });

  it("T5-07 item 6: once both films are past 90 days, keeps only the next episode, which arrived inside the window", async () => {
    const now = arrived + 10 * DAY;
    expect(now - 90 * DAY).toBeGreaterThan(seriesPlay);
    const { whole } = await homeAt(server, now, { window: "90" });
    expect(whole).toEqual([episode.Id]);
  });

  it("T5-07 item 6: a window after the episode arrived, empties the row and makes the first Recently added title the hero", async () => {
    const { home, gateway } = await homeAt(server, arrived + 90 * DAY + 1, { window: "90" });
    const firstAdded = (await gateway.latestItems())[0]!;
    expect(home.continueWatching).toEqual([]);
    expect(home.hero).toMatchObject({ rule: "newest", card: { id: firstAdded.id } });
  });

  it("T5-07 item 6: with all, keeps both films and the next episode", async () => {
    const { whole } = await homeAt(server, arrived + 1000 * DAY, { window: "all" });
    expect(whole).toEqual([episode.Id, newer.Id, older.Id]);
  });
});

describe("Home window recordings, Jellyscale", () => {
  const film = load(JELLYSCALE, "home-resume.json").Items[0] as { Id: string; UserData: { LastPlayedDate: string } };
  const played = when(film.UserData.LastPlayedDate);

  it("T5-07 item 6: every recorded Resume item carries UserData.LastPlayedDate", () => {
    const items = load(JELLYSCALE, "home-resume.json").Items as { UserData: { LastPlayedDate?: string } }[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(Number.isNaN(when(item.UserData.LastPlayedDate ?? ""))).toBe(false);
  });

  it("T5-07 item 6: keeps the film 89 days after its play, with window 90", async () => {
    const { whole } = await homeAt(JELLYSCALE, played + 89 * DAY, { window: "90" });
    expect(whole).toEqual([film.Id]);
  });

  it("T5-07 item 6: drops the film 91 days after its play, and the hero comes from Recently added", async () => {
    const { home, gateway } = await homeAt(JELLYSCALE, played + 91 * DAY, { window: "90" });
    const firstAdded = (await gateway.latestItems())[0]!;
    expect(home.continueWatching).toEqual([]);
    expect(home.hero).toMatchObject({ rule: "newest", card: { id: firstAdded.id } });
  });

  it("T5-07 item 6: reads an omitted window as 90 days", async () => {
    expect((await homeAt(JELLYSCALE, played + 89 * DAY)).whole).toEqual([film.Id]);
    expect((await homeAt(JELLYSCALE, played + 91 * DAY)).home.hero).toMatchObject({ rule: "newest" });
  });
});
