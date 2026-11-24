// T5-03 item 10 (the router half): `enter(rowId, x)` points one row's guide at the card nearest `x`, for focus that enters the rows
// from outside them (the hero), and forgets the last focused card so a later `scrolled()` does not re-point from it.
import { describe, expect, it } from "@jest/globals";
import { canvasScale } from "../scale";
import { cardCentre, nearestCardIndex } from "./row-geometry";
import { createRowMemory } from "./row-memory";
import { createRowRouter } from "./row-router";

const items = (rowId: string, count: number) => Array.from({ length: count }, (_, i) => ({ id: `${rowId}-${i}` }));

function setup() {
  const memory = createRowMemory();
  const router = createRowRouter(memory);
  const rows = [
    { id: "a", variant: "thumb" as const, items: items("a", 12) },
    { id: "b", variant: "poster" as const, items: items("b", 20) },
  ];
  router.update(rows);
  const calls: Record<string, unknown[][]> = { a: [], b: [] };
  const views: Record<string, object> = {};
  for (const row of rows) {
    router.registerGuide(row.id, { setDestinations: (list) => calls[row.id]!.push(list) });
    for (const item of row.items) {
      views[item.id] = { id: item.id };
      router.registerCard(row.id, item.id, views[item.id]);
    }
  }
  return { memory, router, calls, views };
}

describe("row router, enter", () => {
  it("T5-03 item 10: enter points only that row's guide at the card nearest x", () => {
    const { router, calls, views } = setup();
    const x = cardCentre("thumb", 3, 0) + 20;
    router.enter("a", x);
    expect(calls.a).toEqual([[views[`a-${nearestCardIndex("thumb", 12, 0, x)}`]]]);
    expect(nearestCardIndex("thumb", 12, 0, x)).toBe(3);
    expect(calls.b).toEqual([]);
  });

  it("T5-03 item 10: enter uses the row's memory offset, in canvas px, so a scrolled row gives another card", () => {
    const { memory, router, calls, views } = setup();
    const x = cardCentre("poster", 2, 0);
    router.enter("b", x);
    const atStart = nearestCardIndex("poster", 20, 0, x);
    memory.set("b", 1500 * canvasScale());
    router.enter("b", x);
    const scrolled = nearestCardIndex("poster", 20, 1500, x);
    expect(scrolled).not.toBe(atStart);
    expect(calls.b).toEqual([[views[`b-${atStart}`]], [views[`b-${scrolled}`]]]);
  });

  it("T5-03 item 10: enter gives an empty list when the nearest card has no view", () => {
    const { router, calls } = setup();
    const x = cardCentre("thumb", 5, 0);
    router.registerCard("a", `a-${nearestCardIndex("thumb", 12, 0, x)}`, null);
    router.enter("a", x);
    expect(calls.a).toEqual([[]]);
  });

  it("T5-03 item 10: a scrolled() after enter does not re-point from the card focused before it", () => {
    const { memory, router, calls } = setup();
    router.focused("b", 7);
    expect(calls.a).toHaveLength(1);
    router.enter("a", cardCentre("thumb", 1, 0));
    const before = { a: calls.a.length, b: calls.b.length };
    memory.set("b", 600);
    router.scrolled("b");
    memory.set("a", 400);
    router.scrolled("a");
    expect({ a: calls.a.length, b: calls.b.length }).toEqual(before);
  });
});
