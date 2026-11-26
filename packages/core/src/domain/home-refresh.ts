import type { ItemUserData, MediaCard } from "./catalog";
import type { Home } from "./home";

// What the server holds for one title after a viewing of it.
export interface ViewedItem {
  itemId: string;
  userData: ItemUserData;
  runTimeTicks?: number;
}

// The card's play-state fields by the rules of jellyfin/cards.ts, which make them from the server's own answer.
function viewedCard(card: MediaCard, { userData, runTimeTicks = 0 }: ViewedItem): MediaCard {
  const { resumePositionTicks: _position, progress: _progress, remainingTicks: _remaining, played: _played, ...rest } = card;
  const { played, resumePositionTicks: position } = userData;
  const partWatched = position > 0 && runTimeTicks > 0;
  return {
    ...rest,
    ...(!played && position > 0 ? { resumePositionTicks: position } : {}),
    ...(partWatched
      ? { progress: Math.min(1, position / runTimeTicks), remainingTicks: Math.max(0, runTimeTicks - position) }
      : {}),
    ...(played ? { played: true } : {}),
  };
}

// Every card of the viewed item, the hero's and both rows', shows the new play state. No card moves, joins or leaves.
export function withViewedProgress(home: Home, viewed: ViewedItem): Home {
  const patch = (card: MediaCard): MediaCard => (card.id === viewed.itemId ? viewedCard(card, viewed) : card);
  return {
    hero: home.hero.rule === "none" ? home.hero : { ...home.hero, card: patch(home.hero.card) },
    continueWatching: home.continueWatching.map(patch),
    recentlyAdded: home.recentlyAdded.map(patch),
  };
}
