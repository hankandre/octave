// The geometry of a row of cards (T3-08). All values are canvas px (DESIGN.md §6) except `ROW_DRAW_DISTANCE`, which is
// dp: FlashList's `drawDistance` is in layout units, so it is never passed through `px()`. The row converts with
// `px()` when it lays out. This file imports only the tokens, so a Node script can import it.
import { focus, motion, sizes, space, type } from "../tokens";

export type CardVariant = "poster" | "thumb";

/** How far ahead of the viewport a row draws, in dp. Decision 0004's addendum measured 0 of 12 bursts lost at 150 on poster rows. */
export const ROW_DRAW_DISTANCE = 150;

/** The draw distance of a row of this variant, in dp. Both variants use the measured default. */
export function drawDistanceFor(_variant: CardVariant): number {
  return ROW_DRAW_DISTANCE;
}

export const cardGap = space.space5;

const GRID = space.space1;
const roundUpToGrid = (value: number): number => Math.ceil(value / GRID) * GRID;

/** The widest card's lift beyond its own edge, plus the ring and its outer line, rounded up to the 4 px grid. */
const ringReach = focus.focusOffset + focus.focusRingWidth + focus.focusEdgeWidth;
export const rowInsetStart = roundUpToGrid(ringReach + (Math.max(sizes.posterW, sizes.thumbW) * (motion.lift - 1)) / 2);

export function cardWidth(variant: CardVariant): number {
  return variant === "poster" ? sizes.posterW : sizes.thumbW;
}

export function cardHeight(variant: CardVariant): number {
  return variant === "poster" ? sizes.posterW * 1.5 : (sizes.thumbW * 9) / 16;
}

/** Space above the art for the lift and the ring, so the first line of a row is not clipped. */
export const cardTopInset = roundUpToGrid(ringReach + (cardHeight("poster") * (motion.lift - 1)) / 2);

/** The space between the art and the title: it clears the lift and the ring. */
export const cardTextGap = space.space5;

/** The height of a row's list: headroom, the art, the gap, then a title line and a subtitle line. */
export function rowListHeight(variant: CardVariant): number {
  return Math.ceil(cardTopInset + cardHeight(variant) + cardTextGap + type.typeLabel.size * type.typeLabel.lineHeight + type.typeMeta.size * type.typeMeta.lineHeight);
}

/** The centre x of card `index` after the row scrolled by `offset`. */
export function cardCentre(variant: CardVariant, index: number, offset: number): number {
  return rowInsetStart + index * (cardWidth(variant) + cardGap) + cardWidth(variant) / 2 - offset;
}

/** The index of the card whose centre is nearest `x`, a tie going to the lower index. Clamped to `[0, count - 1]`. */
export function nearestCardIndex(variant: CardVariant, count: number, offset: number, x: number): number {
  if (count <= 1) return 0;
  const stride = cardWidth(variant) + cardGap;
  const estimate = Math.floor((x + offset - rowInsetStart - cardWidth(variant) / 2) / stride);
  const low = Math.min(Math.max(estimate, 0), count - 1);
  const high = Math.min(low + 1, count - 1);
  return Math.abs(cardCentre(variant, high, offset) - x) < Math.abs(cardCentre(variant, low, offset) - x) ? high : low;
}
