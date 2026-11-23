// A test double for `design/rows/row-router` (frozen with T3-09). Each frozen file that renders the fixture Home starts with
// `jest.mock("../design/rows/row-router", () => require("./test-support/row-router-spy"))` (path relative to the test file,
// which sits in `src/shell/`).
//
// `createRowRouter(memory)` returns the real router (`jest.requireActual`) with `clear` wrapped in a jest.fn, and with
// `registerGuide` and `registerCard` wrapped so they also record, per router, each row's guide and each (rowId, itemId)'s
// view. A recorded guide is wrapped so every `setDestinations(list)` call is kept, in order, and then passed on.
// `routers()` returns every router created since the last `resetRouters()`.
import { jest } from "@jest/globals";
import type { RowMemory } from "../../design/rows/row-memory";
import type { RowRouter } from "../../design/rows/row-router";

type Actual = { createRowRouter(memory: RowMemory): RowRouter & { clear?: () => void } };
type Guide = { setDestinations?: (destinations: unknown[]) => void };

const actual = jest.requireActual<Actual>("../../design/rows/row-router");

export type SpyRouter = {
  router: RowRouter;
  /** The wrapped `clear`: calls the real one when the router has it. */
  clear: ReturnType<typeof jest.fn>;
  /** The view `registerCard` last got for the item, or `undefined`. */
  cardView(rowId: string, itemId: string): unknown;
  /** The ids of the rows whose guide was registered. */
  guideRows(): string[];
  /** Every array the row's guide was given through `setDestinations`, in order. */
  destinationCalls(rowId: string): unknown[][];
};

const created: SpyRouter[] = [];

export function routers(): SpyRouter[] {
  return [...created];
}

export function resetRouters(): void {
  created.length = 0;
}

const keyOf = (rowId: string, itemId: string): string => `${rowId}\u0000${itemId}`;

export function createRowRouter(memory: RowMemory): RowRouter {
  const real = actual.createRowRouter(memory);
  const calls = new Map<string, unknown[][]>();
  const views = new Map<string, unknown>();
  const clear = jest.fn(() => {
    real.clear?.();
  });
  const router = {
    ...real,
    clear,
    registerGuide(rowId: string, guide: Guide | null) {
      if (guide === null) {
        real.registerGuide(rowId, null);
        return;
      }
      if (!calls.has(rowId)) calls.set(rowId, []);
      const wrapped: Guide = {
        setDestinations(destinations) {
          calls.get(rowId)?.push([...destinations]);
          try {
            guide.setDestinations?.(destinations);
          } catch {
            // The host's own command is not what these tests are about.
          }
        },
      };
      real.registerGuide(rowId, wrapped);
    },
    registerCard(rowId: string, itemId: string, view: unknown) {
      if (view === null) views.delete(keyOf(rowId, itemId));
      else views.set(keyOf(rowId, itemId), view);
      real.registerCard(rowId, itemId, view);
    },
  };
  created.push({
    router: router as unknown as RowRouter,
    clear,
    cardView: (rowId, itemId) => views.get(keyOf(rowId, itemId)),
    guideRows: () => [...calls.keys()],
    destinationCalls: (rowId) => calls.get(rowId) ?? [],
  });
  return router as unknown as RowRouter;
}
