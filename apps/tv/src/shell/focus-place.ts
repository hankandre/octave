// Where focus was last, per screen (T3-09 item 4). `restoreTarget` is DESIGN.md §9's rule for returning to a card: the same
// item in the same row; else the card now at the same index, clamped to the row's last card; else the screen's opening focus.
// The store is the shell's own (one per AppShell), keyed by the stack's route key.
import type { FocusReporter, RowsHandle } from "../design/rows/focus-place-context";

export type SavedCard = { rowId: string; itemId: string; index: number };
export type RestoreTarget = { kind: "card"; rowId: string; index: number } | { kind: "opening" };

export function restoreTarget(saved: SavedCard | undefined, rows: { id: string; items: { id: string }[] }[]): RestoreTarget {
  if (saved === undefined) return { kind: "opening" };
  const row = rows.find((candidate) => candidate.id === saved.rowId);
  if (row === undefined || row.items.length === 0) return { kind: "opening" };
  const found = row.items.findIndex((item) => item.id === saved.itemId);
  if (found >= 0) return { kind: "card", rowId: row.id, index: found };
  return { kind: "card", rowId: row.id, index: Math.max(0, Math.min(saved.index, row.items.length - 1)) };
}

export type Place = {
  /** The content element that last took focus. */
  view?: unknown;
  /** Set when that element is a card. */
  card?: SavedCard;
  /** The view of the screen's primary action. */
  opening?: unknown;
  rows?: RowsHandle | null;
};

export type FocusPlaces = {
  get(routeKey: string): Place | undefined;
  reporterFor(routeKey: string): FocusReporter;
  drop(routeKey: string): void;
};

export function createFocusPlaces(): FocusPlaces {
  const places = new Map<string, Place>();
  const reporters = new Map<string, FocusReporter>();

  const placeOf = (routeKey: string): Place => {
    let place = places.get(routeKey);
    if (place === undefined) {
      place = {};
      places.set(routeKey, place);
    }
    return place;
  };

  return {
    get: (routeKey) => places.get(routeKey),
    reporterFor(routeKey) {
      let reporter = reporters.get(routeKey);
      if (reporter === undefined) {
        reporter = {
          focused(_key, view, card) {
            const place = placeOf(routeKey);
            place.view = view;
            place.card = card;
          },
          opening(view) {
            placeOf(routeKey).opening = view;
          },
          rows(handle) {
            placeOf(routeKey).rows = handle;
          },
        };
        reporters.set(routeKey, reporter);
      }
      return reporter;
    },
    drop(routeKey) {
      places.delete(routeKey);
      reporters.delete(routeKey);
    },
  };
}
