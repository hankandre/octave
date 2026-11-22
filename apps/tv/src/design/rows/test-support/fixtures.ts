// Fixtures for the frozen T3-08 tests, and the props and testID contract the components follow.
//
// Props and testID contract
// - CardItem (media-card.tsx): { id, title, subtitle?, image?: ImageRef, progress?, played?, accessibilityLabel? }.
// - MediaCard (media-card.tsx): item, variant ("poster" | "thumb"), onFocus?, onBlur?, onPress?, hasTVPreferredFocus?, testID.
// - ArtworkProvider (artwork.tsx): component?: ArtworkComponent, playedIcon?: IconComponent, children.
//   ArtworkComponent = ComponentType<{ image: ImageRef; width: number; height: number; onFailed: () => void; testID?: string }>,
//   width and height in canvas px. It receives exactly image, width, height, onFailed and testID, so no URL, header or token.
// - MediaRow (media-row.tsx): rowId, title, variant, items, memory: RowMemory, leftEdge? ("trap" default | "open"),
//   onCardFocus?(rowId, index), onCardBlur?(rowId, index), onCardPress?(rowId, index), testID.
// - RowList (row-list.tsx): rows: RowSpec[], memory, leftEdge?, header?, onCardFocus?, onCardBlur?, onCardPress?, testID.
//   RowSpec = { id, title, variant, items }.
// - RowMemory (row-memory.ts): { get(rowId): number; set(rowId, offset): void }, created by createRowMemory(). The offset is
//   the list's scroll offset in dp. get returns 0 for an unknown id.
// - row-geometry.ts: ROW_DRAW_DISTANCE (dp), cardWidth(variant), cardGap, rowInsetStart, cardCentre(variant, index, offset),
//   nearestCardIndex(variant, count, offset, x). All canvas px except ROW_DRAW_DISTANCE.
//
// testIDs, with r a row's testID, l a RowList's, c a card's
// - r: the row; r-title; r-guide (TVFocusGuideView); r-list (horizontal FlashList); r-card-<index> (each card, passed as the
//   card's testID).
// - l-list: the vertical FlashList; l-row-<rowId>: each row's testID.
// - c: the card's Pressable, the one focusable element; c-art; c-focus-ring; c-artwork; c-missing; c-title; c-subtitle;
//   c-progress; c-progress-fill; c-played.
//
// No literal design value appears here or in the frozen tests: sizes come from the tokens through px().
import { View } from "react-native";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import type { ReactElement } from "react";
import type { CardItem } from "../media-card";
import { createElement } from "react";

const SYNTHETIC_IMAGE: Omit<ImageRef, "itemId"> = { type: "Primary", tag: "synthetic-tag" };

function imageFor(id: string): ImageRef {
  return { itemId: `${id}-image`, ...SYNTHETIC_IMAGE };
}

/** `count` cards with ids `${rowId}-item-${i}` and plain synthetic titles. */
export function fixtureItems(rowId: string, count: number, overrides: Partial<CardItem> = {}): CardItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${rowId}-item-${i}`,
    title: `Title ${i}`,
    image: imageFor(`${rowId}-item-${i}`),
    ...overrides,
  }));
}

export const FIXTURE_PROGRESS = 0.4;

const plain: CardItem = { id: "card-plain", title: "Fixture title", subtitle: "Fixture subtitle", image: imageFor("card-plain") };

/** Cards for item 6. The same item serves both variants. */
export const cardPlain: CardItem = plain;
export const cardProgress: CardItem = { ...plain, id: "card-progress", progress: FIXTURE_PROGRESS };
export const cardPlayed: CardItem = { ...plain, id: "card-played", played: true };
export const cardNoImage: CardItem = { id: "card-no-image", title: "Fixture title", subtitle: "Fixture subtitle" };

/** Every prop set `FixtureArtwork` was rendered with, in order, exactly as it received them. */
export const artworkCalls: Record<string, unknown>[] = [];

export function resetArtworkCalls(): void {
  artworkCalls.length = 0;
}

/** A test ArtworkComponent: records the props it gets and renders a View under the testID it was given. */
export function FixtureArtwork(props: { image: ImageRef; width: number; height: number; onFailed: () => void; testID?: string }): ReactElement {
  artworkCalls.push({ ...props });
  return createElement(View, { testID: props.testID });
}
