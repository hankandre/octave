import { describe, expect, it, vi } from "vitest";
import type { ItemDetail, ItemVersion, MediaCard, SeriesNextUp } from "./catalog";
import { ItemNotFoundError } from "./catalog";
import { heroFacts, heroPlay, loadHeroExtras, playRequestOf, timeLeftLabel, timeLeftSpoken, type HeroSource } from "./home-hero";
import { startOverChoice } from "./playback";

// T5-03 items 1 and 9: what Home hands playback for a card, and the hero's facts line and the one item read behind it.
// Pure: the source is a fake. The Home line of ARCHITECTURE.md section 3 and DESIGN.md section 7.3 are where the words come from.
const MINUTE = 600_000_000;

const card = (over: Partial<MediaCard> & Pick<MediaCard, "id">): MediaCard => ({ kind: "Movie", title: over.id, aspectRatio: 2 / 3, ...over });
const detail = (over: Partial<ItemDetail> = {}): ItemDetail => ({
  id: "x",
  type: "Movie",
  title: "x",
  genres: [],
  cast: [],
  userData: { played: false, favorite: false, resumePositionTicks: 0 },
  versions: [],
  ...over,
});
const version = (width: number | undefined, height: number | undefined, hdr: NonNullable<ItemVersion["video"]>["hdr"]): ItemVersion => ({
  id: "v",
  name: "v",
  audio: [],
  subtitles: [],
  video: { ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }), hdr },
});

describe("playRequestOf", () => {
  it("T5-03 item 1: a film with a saved position resumes from it", () => {
    expect(playRequestOf(card({ id: "f", resumePositionTicks: 90 * MINUTE }))).toEqual({ itemId: "f", start: { kind: "resume", startPositionTicks: 90 * MINUTE } });
  });

  it("T5-03 item 1: an episode with no saved position starts over", () => {
    expect(playRequestOf(card({ id: "e", kind: "Episode" }))).toEqual({ itemId: "e", start: startOverChoice() });
    expect(playRequestOf(card({ id: "e", kind: "Episode" }))?.start.startPositionTicks).toBe(0);
  });

  it("T5-03 item 1: a played film starts over", () => {
    expect(playRequestOf(card({ id: "p", played: true }))).toEqual({ itemId: "p", start: startOverChoice() });
  });

  it("T5-03 item 1: a card of kind Other plays like a film", () => {
    expect(playRequestOf(card({ id: "o", kind: "Other", resumePositionTicks: 5 }))).toEqual({ itemId: "o", start: { kind: "resume", startPositionTicks: 5 } });
  });

  it("T5-03 item 1: a Series and a BoxSet give nothing to play", () => {
    expect(playRequestOf(card({ id: "s", kind: "Series" }))).toBeUndefined();
    expect(playRequestOf(card({ id: "b", kind: "BoxSet" }))).toBeUndefined();
  });
});

describe("heroPlay", () => {
  const next: SeriesNextUp = { id: "next", title: "Next", seasonNumber: 1, episodeNumber: 3, resumePositionTicks: 7 * MINUTE };

  it("T5-03 item 1: a film is its own request and ignores a next episode", () => {
    expect(heroPlay(card({ id: "f", resumePositionTicks: 3 }), next)).toEqual({ itemId: "f", start: { kind: "resume", startPositionTicks: 3 } });
    expect(heroPlay(card({ id: "f" }))).toEqual({ itemId: "f", start: startOverChoice() });
  });

  it("T5-03 item 1: a Series hands its next episode and that episode's position", () => {
    expect(heroPlay(card({ id: "s", kind: "Series" }), next)).toEqual({ itemId: "next", start: { kind: "resume", startPositionTicks: 7 * MINUTE } });
    expect(heroPlay(card({ id: "s", kind: "Series" }), { id: "first", title: "First" })).toEqual({ itemId: "first", start: startOverChoice() });
  });

  it("T5-03 item 1: a Series with no next episode gives nothing to play", () => {
    expect(heroPlay(card({ id: "s", kind: "Series" }))).toBeUndefined();
  });
});

describe("time left", () => {
  it("T5-03 item 9: reads whole minutes under an hour, rounded, at least one", () => {
    expect(timeLeftLabel(38 * MINUTE)).toBe("38 min left");
    expect(timeLeftLabel(38.4 * MINUTE)).toBe("38 min left");
    expect(timeLeftLabel(38.6 * MINUTE)).toBe("39 min left");
    expect(timeLeftLabel(0.2 * MINUTE)).toBe("1 min left");
    expect(timeLeftLabel(59 * MINUTE)).toBe("59 min left");
  });

  it("T5-03 item 9: reads hours and minutes from an hour, and the hours alone at a whole hour", () => {
    expect(timeLeftLabel(63 * MINUTE)).toBe("1 h 3 min left");
    expect(timeLeftLabel(125 * MINUTE)).toBe("2 h 5 min left");
    expect(timeLeftLabel(60 * MINUTE)).toBe("1 h left");
    expect(timeLeftLabel(120 * MINUTE)).toBe("2 h left");
  });

  it("T5-03 item 9: speaks the same time in words", () => {
    expect(timeLeftSpoken(38 * MINUTE)).toBe("38 minutes left");
    expect(timeLeftSpoken(1 * MINUTE)).toBe("1 minute left");
    expect(timeLeftSpoken(0.2 * MINUTE)).toBe("1 minute left");
    expect(timeLeftSpoken(125 * MINUTE)).toBe("2 hours 5 minutes left");
  });
});

describe("heroFacts", () => {
  it("T5-03 item 9: an episode with time left reads its numbers, then the time left", () => {
    const episode = card({ id: "e", kind: "Episode", seasonNumber: 1, episodeNumber: 2, remainingTicks: 38 * MINUTE });
    expect(heroFacts(episode)).toBe("S1 · E2 · 38 min left");
    expect(heroFacts(episode, detail({ runTimeTicks: 45 * MINUTE }))).toBe("S1 · E2 · 38 min left");
  });

  it("T5-03 item 9: an episode with no time left reads the runtime from the detail, and nothing before it arrives", () => {
    const episode = card({ id: "e", kind: "Episode", seasonNumber: 3, episodeNumber: 10 });
    expect(heroFacts(episode)).toBe("S3 · E10");
    expect(heroFacts(episode, detail({ runTimeTicks: 45 * MINUTE }))).toBe("S3 · E10 · 45 min");
  });

  it("T5-03 item 9: an episode with only one number leaves the numbers out", () => {
    const episode = card({ id: "e", kind: "Episode", seasonNumber: 3 });
    expect(heroFacts(episode, detail({ runTimeTicks: 45 * MINUTE }))).toBe("45 min");
  });

  it("T5-03 item 9: a film reads its year, runtime, 4K and range, and an in-progress film shows its runtime, not the time left", () => {
    const film = card({ id: "f", subtitle: "2023", remainingTicks: 33 * MINUTE, resumePositionTicks: 90 * MINUTE });
    const full = detail({ year: 2023, runTimeTicks: 123 * MINUTE, versions: [version(3840, 2160, "Dolby Vision")] });
    expect(heroFacts(film, full)).toBe("2023 · 2 h 3 min · 4K · Dolby Vision");
  });

  it("T5-03 item 9: a film's year is the detail's, else the card's year", () => {
    const film = card({ id: "f", subtitle: "2023" });
    expect(heroFacts(film)).toBe("2023");
    expect(heroFacts(film, detail({ year: 2022, runTimeTicks: 100 * MINUTE }))).toBe("2022 · 1 h 40 min");
    expect(heroFacts(card({ id: "g" }))).toBe("");
  });

  it("T5-03 item 9: 4K needs 3200 px of width or 1800 px of height", () => {
    const facts = (width: number, height: number) => heroFacts(card({ id: "f", subtitle: "2023" }), detail({ year: 2023, versions: [version(width, height, "SDR")] }));
    expect(facts(3200, 1000)).toBe("2023 · 4K");
    expect(facts(1000, 1800)).toBe("2023 · 4K");
    expect(facts(3199, 1799)).toBe("2023");
    expect(facts(1920, 1080)).toBe("2023");
  });

  it("T5-03 item 9: every range value maps to its word, and SDR and Unknown add nothing", () => {
    const range = (hdr: NonNullable<ItemVersion["video"]>["hdr"]) => heroFacts(card({ id: "f", subtitle: "2023" }), detail({ year: 2023, versions: [version(1920, 1080, hdr)] }));
    expect(range("Dolby Vision")).toBe("2023 · Dolby Vision");
    expect(range("Dolby Vision / HDR10")).toBe("2023 · Dolby Vision");
    expect(range("Dolby Vision / HDR10+")).toBe("2023 · Dolby Vision");
    expect(range("Dolby Vision / HLG")).toBe("2023 · Dolby Vision");
    expect(range("Dolby Vision / SDR")).toBe("2023 · Dolby Vision");
    expect(range("HDR10+")).toBe("2023 · HDR10+");
    expect(range("HDR10")).toBe("2023 · HDR10");
    expect(range("HLG")).toBe("2023 · HLG");
    expect(range("HDR")).toBe("2023 · HDR");
    expect(range("SDR")).toBe("2023");
    expect(range("Unknown")).toBe("2023");
  });

  it("T5-03 item 9: the quality facts are the first version's, and a version with no video adds none", () => {
    const film = card({ id: "f", subtitle: "2023" });
    expect(heroFacts(film, detail({ year: 2023, versions: [version(1920, 1080, "SDR"), version(3840, 2160, "HDR10")] }))).toBe("2023");
    expect(heroFacts(film, detail({ year: 2023, versions: [{ id: "v", name: "v", audio: [], subtitles: [] }] }))).toBe("2023");
  });

  it("T5-03 item 9: a series reads its year, or its span when it ended, then its next episode", () => {
    const show = card({ id: "s", kind: "Series" });
    const next: SeriesNextUp = { id: "n", title: "N", seasonNumber: 2, episodeNumber: 5 };
    expect(heroFacts(show, detail({ type: "Series", year: 2019, endYear: 2022 }), next)).toBe("2019–2022 · S2 · E5");
    expect(heroFacts(show, detail({ type: "Series", year: 2019 }), next)).toBe("2019 · S2 · E5");
    expect(heroFacts(show, detail({ type: "Series", year: 2019 }))).toBe("2019");
    expect(heroFacts(show, detail({ type: "Series", year: 2019 }), { id: "n", title: "N" })).toBe("2019");
  });
});

describe("loadHeroExtras", () => {
  const fake = (over: Partial<HeroSource> = {}) => {
    const itemDetail = vi.fn(async (id: string, _signal?: AbortSignal) => detail({ id }));
    const seriesNextUp = vi.fn(async (_id: string, _signal?: AbortSignal): Promise<SeriesNextUp | undefined> => ({ id: "next", title: "Next" }));
    return { itemDetail, seriesNextUp, source: { itemDetail, seriesNextUp, ...over } as HeroSource };
  };
  const hero = (over: Partial<MediaCard> & Pick<MediaCard, "id">) => ({ rule: "row" as const, card: card(over) });

  it("T5-03 item 9: a film reads its detail once and never asks for a next episode", async () => {
    const { source, itemDetail, seriesNextUp } = fake();
    const signal = new AbortController().signal;
    const extras = await loadHeroExtras(source, hero({ id: "film" }), signal);
    expect(itemDetail).toHaveBeenCalledTimes(1);
    expect(itemDetail).toHaveBeenCalledWith("film", signal);
    expect(seriesNextUp).not.toHaveBeenCalled();
    expect(extras.detail?.id).toBe("film");
    expect(extras.next).toBeUndefined();
  });

  it("T5-03 item 9: a Series reads its detail once and its next episode once, both by the series id", async () => {
    const { source, itemDetail, seriesNextUp } = fake();
    const signal = new AbortController().signal;
    const extras = await loadHeroExtras(source, hero({ id: "show", kind: "Series" }), signal);
    expect(itemDetail).toHaveBeenCalledTimes(1);
    expect(itemDetail).toHaveBeenCalledWith("show", signal);
    expect(seriesNextUp).toHaveBeenCalledTimes(1);
    expect(seriesNextUp).toHaveBeenCalledWith("show", signal);
    expect(extras.next).toEqual({ id: "next", title: "Next" });
  });

  it("T5-03 item 9: a 404, a 500 and a status of 0 each give no detail and do not reject", async () => {
    for (const failure of [new ItemNotFoundError(), Object.assign(new Error("boom"), { status: 500 }), Object.assign(new Error("offline"), { status: 0 })]) {
      const { source } = fake({ itemDetail: async () => { throw failure; } });
      const extras = await loadHeroExtras(source, hero({ id: "film" }), new AbortController().signal);
      expect(extras.detail).toBeUndefined();
    }
  });

  it("T5-03 item 9: a failed next-episode read leaves the detail and gives no next episode", async () => {
    const { source } = fake({ seriesNextUp: async () => { throw Object.assign(new Error("boom"), { status: 500 }); } });
    const extras = await loadHeroExtras(source, hero({ id: "show", kind: "Series" }), new AbortController().signal);
    expect(extras.detail?.id).toBe("show");
    expect(extras.next).toBeUndefined();
  });

  it("T5-03 item 9: an abort rejects, even when the reads settle", async () => {
    const controller = new AbortController();
    const { source } = fake({
      itemDetail: async (id) => {
        controller.abort();
        return detail({ id });
      },
    });
    await expect(loadHeroExtras(source, hero({ id: "film" }), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("T5-03 item 9: an abort that fails the read rejects too, rather than reading as no detail", async () => {
    const controller = new AbortController();
    const { source } = fake({
      itemDetail: async () => {
        controller.abort();
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    });
    await expect(loadHeroExtras(source, hero({ id: "film" }), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
