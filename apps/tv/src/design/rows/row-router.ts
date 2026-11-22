// Up and Down between rows (T3-08, "Up and Down", the fallback milestone 5 called for). Left alone, Android's focus
// search can pick a card in the next row that is not the nearest one when the rows differ in card width: from a thumb
// up to a poster row it landed one to three cards away in 4 of 4 presses. So when a card takes focus, each adjacent
// row's focus guide is told which card to receive focus: the one `nearestCardIndex` names after that row's offset.
// `setDestinations` is imperative, so no row renders for it. No user data is held: ids and views only.
import { canvasScale } from "../scale";
import { cardCentre, nearestCardIndex, type CardVariant } from "./row-geometry";
import type { RowMemory } from "./row-memory";

type Guide = { setDestinations?: (destinations: unknown[]) => void };
type RouterRow = { id: string; variant: CardVariant; items: { id: string }[] };

export type RowRouter = {
  /** The rows now shown, in order. */
  update(rows: RouterRow[]): void;
  registerGuide(rowId: string, guide: Guide | null): void;
  /** Hold the view that shows an item, or drop it with `null`. */
  registerCard(rowId: string, itemId: string, view: unknown): void;
  /** A card took focus: point the rows above and below at their nearest card. */
  focused(rowId: string, index: number): void;
  /** A row scrolled: when it holds the focused card, point the neighbours again (its offset moved after the focus event). */
  scrolled(rowId: string): void;
};

const keyOf = (rowId: string, itemId: string): string => `${rowId}\u0000${itemId}`;

export function createRowRouter(memory: RowMemory): RowRouter {
  let rows: RouterRow[] = [];
  const guides = new Map<string, Guide>();
  const cards = new Map<string, unknown>();
  let last: { rowId: string; index: number } | null = null;

  const router: RowRouter = {
    update(next) {
      rows = next;
    },
    registerGuide(rowId, guide) {
      if (guide === null) guides.delete(rowId);
      else guides.set(rowId, guide);
    },
    registerCard(rowId, itemId, view) {
      if (view === null) cards.delete(keyOf(rowId, itemId));
      else cards.set(keyOf(rowId, itemId), view);
    },
    scrolled(rowId) {
      if (last !== null && last.rowId === rowId) router.focused(rowId, last.index);
    },
    focused(rowId, index) {
      last = { rowId, index };
      const at = rows.findIndex((row) => row.id === rowId);
      if (at < 0) return;
      const source = rows[at];
      if (source === undefined) return;
      const scale = canvasScale();
      const x = cardCentre(source.variant, index, memory.get(rowId) / scale);
      for (const neighbour of [rows[at - 1], rows[at + 1]]) {
        if (neighbour === undefined || neighbour.items.length === 0) continue;
        const guide = guides.get(neighbour.id);
        if (guide?.setDestinations === undefined) continue;
        const target = nearestCardIndex(neighbour.variant, neighbour.items.length, memory.get(neighbour.id) / scale, x);
        const item = neighbour.items[target];
        const view = item === undefined ? undefined : cards.get(keyOf(neighbour.id, item.id));
        guide.setDestinations(view === undefined ? [] : [view]);
      }
    },
  };
  return router;
}
