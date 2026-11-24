import type { ItemDetail, ItemVersion, MediaCard, SeriesNextUp } from "./catalog";
import { runtimeLabel } from "./media-format";
import { startOverChoice, type PlaybackStartChoice } from "./playback";
import type { UpNext } from "./up-next";

// What Home hands playback for a card, and the hero's facts line with the one item read behind it (T5-03 D3, D4).
// Pure: a server is reached only through HeroSource, and nothing here builds a media URL.

const TICKS_PER_MINUTE = 600_000_000;
const MINUTES_PER_HOUR = 60;

// What the playback use case (T8-03) receives: an item id and where to start, never a URL.
export interface PlayRequest {
  itemId: string;
  start: PlaybackStartChoice;
}

// The two reads the hero makes after the lists settle. JellyfinGateway satisfies it structurally.
export interface HeroSource {
  itemDetail(id: string, signal?: AbortSignal): Promise<ItemDetail>;
  seriesNextUp(seriesId: string, signal?: AbortSignal): Promise<SeriesNextUp | undefined>;
}

export type Hero = Exclude<UpNext, { rule: "none" }>;

function startOf(resumePositionTicks: number | undefined): PlaybackStartChoice {
  if (resumePositionTicks !== undefined && resumePositionTicks > 0) return { kind: "resume", startPositionTicks: resumePositionTicks };
  return startOverChoice();
}

// A card with a saved position resumes from it; any other starts over. A Series or a BoxSet has nothing to play directly.
export function playRequestOf(card: MediaCard): PlayRequest | undefined {
  if (card.kind === "Series" || card.kind === "BoxSet") return undefined;
  return { itemId: card.id, start: startOf(card.resumePositionTicks) };
}

// The hero's request: a Series hands its next episode, any other card its own request.
export function heroPlay(card: MediaCard, next?: SeriesNextUp): PlayRequest | undefined {
  if (card.kind !== "Series") return playRequestOf(card);
  if (next === undefined) return undefined;
  return { itemId: next.id, start: startOf(next.resumePositionTicks) };
}

function wholeMinutes(ticks: number): number {
  return Math.max(1, Math.round(ticks / TICKS_PER_MINUTE));
}

// "38 min left", "1 h 3 min left", "2 h left".
export function timeLeftLabel(ticks: number): string {
  const minutes = wholeMinutes(ticks);
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min left`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? `${hours} h left` : `${hours} h ${rest} min left`;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

// The same time in words, for a screen reader.
export function timeLeftSpoken(ticks: number): string {
  const minutes = wholeMinutes(ticks);
  if (minutes < MINUTES_PER_HOUR) return `${plural(minutes, "minute")} left`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? `${plural(hours, "hour")} left` : `${plural(hours, "hour")} ${plural(rest, "minute")} left`;
}

const WIDE_4K = 3200;
const TALL_4K = 1800;

function rangeWord(hdr: string): string | undefined {
  if (hdr.startsWith("Dolby Vision")) return "Dolby Vision";
  switch (hdr) {
    case "HDR10+":
    case "HDR10":
    case "HLG":
    case "HDR":
      return hdr;
    default:
      return undefined;
  }
}

// The first version's "4K" and range words (DESIGN.md §7.9's badges). Nothing for SDR, Unknown or a version with no video.
export function qualityFacts(version?: ItemVersion): string[] {
  const video = version?.video;
  if (video === undefined) return [];
  const facts: string[] = [];
  if ((video.width ?? 0) >= WIDE_4K || (video.height ?? 0) >= TALL_4K) facts.push("4K");
  const range = rangeWord(video.hdr);
  if (range !== undefined) facts.push(range);
  return facts;
}

const YEAR = /^\d{4}$/;

function episodeNumbers(card: { seasonNumber?: number; episodeNumber?: number }): string | undefined {
  if (card.seasonNumber === undefined || card.episodeNumber === undefined) return undefined;
  return `S${card.seasonNumber} · E${card.episodeNumber}`;
}

function present(parts: (string | undefined)[]): string[] {
  return parts.filter((part): part is string => part !== undefined && part !== "");
}

function yearOf(card: MediaCard, detail?: ItemDetail): string | undefined {
  if (detail?.year !== undefined) return String(detail.year);
  return card.subtitle !== undefined && YEAR.test(card.subtitle) ? card.subtitle : undefined;
}

// The hero's one facts line (DESIGN.md §7.3), parts joined with " · ". Before the detail arrives it is what the card gives.
export function heroFacts(card: MediaCard, detail?: ItemDetail, next?: SeriesNextUp): string {
  switch (card.kind) {
    case "Episode":
      return present([
        episodeNumbers(card),
        card.remainingTicks !== undefined ? timeLeftLabel(card.remainingTicks) : runtimeLabel(detail?.runTimeTicks),
      ]).join(" · ");
    case "Series": {
      const year = yearOf(card, detail);
      const span = year !== undefined && detail?.endYear !== undefined ? `${year}–${detail.endYear}` : year;
      return present([span, next === undefined ? undefined : episodeNumbers(next)]).join(" · ");
    }
    default:
      return present([yearOf(card, detail), runtimeLabel(detail?.runTimeTicks), ...qualityFacts(detail?.versions[0])]).join(" · ");
  }
}

function abortReason(signal: AbortSignal): unknown {
  // The host types of the core do not declare `reason`.
  const reason = (signal as { reason?: unknown }).reason;
  return reason ?? Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

// Anything but an abort reads as nothing: the hero keeps the card's facts and shows no overview (T5-04 owns error copy).
async function orNothing<T>(read: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  try {
    const value = await read;
    if (signal.aborted) throw abortReason(signal);
    return value;
  } catch {
    if (signal.aborted) throw abortReason(signal);
    return undefined;
  }
}

// The hero's own item read, for its overview and quality facts. Rejects only when the signal aborts.
export function loadHeroDetail(source: HeroSource, card: MediaCard, signal: AbortSignal): Promise<ItemDetail | undefined> {
  return orNothing(source.itemDetail(card.id, signal), signal);
}

// A Series hero's next episode: a series cannot be handed to playback. Nothing for any other card.
export async function loadHeroNext(source: HeroSource, card: MediaCard, signal: AbortSignal): Promise<SeriesNextUp | undefined> {
  if (card.kind !== "Series") return undefined;
  return orNothing(source.seriesNextUp(card.id, signal), signal);
}

// Both reads at once: one item read of the hero, plus the next-episode read for a Series.
export async function loadHeroExtras(source: HeroSource, hero: Hero, signal: AbortSignal): Promise<{ detail?: ItemDetail; next?: SeriesNextUp }> {
  const [detail, next] = await Promise.all([loadHeroDetail(source, hero.card, signal), loadHeroNext(source, hero.card, signal)]);
  return { ...(detail === undefined ? {} : { detail }), ...(next === undefined ? {} : { next }) };
}
