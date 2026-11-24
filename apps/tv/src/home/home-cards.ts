// MediaCard to CardItem for Home's two rows (T5-03 D6). Pure: the card gives words and an ImageRef, never a URL.
import type { MediaCard } from "@octave/core/src/domain/catalog";
import { timeLeftLabel, timeLeftSpoken } from "@octave/core/src/domain/home-hero";
import type { CardItem } from "../design/rows";

const JOIN = " · ";

/** The art a backdrop layer draws for a card: its own backdrop, else its parent's, else nothing. */
export const backdropOf = (card: MediaCard) => card.backdrop ?? card.parentBackdrop;

function continueSubtitle(card: MediaCard): string | undefined {
  if (card.remainingTicks === undefined) return card.subtitle;
  const numbers = card.seasonNumber !== undefined && card.episodeNumber !== undefined ? `S${card.seasonNumber}${JOIN}E${card.episodeNumber}` : undefined;
  return [numbers, timeLeftLabel(card.remainingTicks)].filter((part): part is string => part !== undefined).join(JOIN);
}

/** A Continue watching card (DESIGN.md §7.5): thumb art, "S1 · E2 · 38 min left" under the title. */
export function continueCard(card: MediaCard): CardItem {
  const spoken = [card.title, card.subtitle?.split(JOIN).join(" "), card.remainingTicks === undefined ? undefined : timeLeftSpoken(card.remainingTicks)];
  const subtitle = continueSubtitle(card);
  const image = card.thumb ?? card.backdrop ?? card.parentBackdrop ?? card.image;
  return {
    id: card.id,
    title: card.title,
    ...(subtitle === undefined ? {} : { subtitle }),
    ...(image === undefined ? {} : { image }),
    ...(card.progress === undefined ? {} : { progress: card.progress }),
    ...(card.played === undefined ? {} : { played: card.played }),
    accessibilityLabel: spoken.filter((part): part is string => part !== undefined).join(", "),
  };
}

/** A Recently added card: poster art, the year under the title. */
export function addedCard(card: MediaCard): CardItem {
  return {
    id: card.id,
    title: card.title,
    ...(card.subtitle === undefined ? {} : { subtitle: card.subtitle }),
    ...(card.image === undefined ? {} : { image: card.image }),
    ...(card.played === undefined ? {} : { played: card.played }),
  };
}
