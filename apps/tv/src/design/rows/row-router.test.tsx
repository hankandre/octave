// The focus router (T3-08, "Up and Down"): the rows above and below a focused card are pointed at their nearest card.
import { describe, expect, it } from "@jest/globals";
import { cardCentre, nearestCardIndex } from "./row-geometry";
import { createRowMemory } from "./row-memory";
import { createRowRouter } from "./row-router";
import { canvasScale } from "../scale";

const items = (rowId: string, count: number) => Array.from({ length: count }, (_, i) => ({ id: `${rowId}-${i}` }));

function setup() {
  const memory = createRowMemory();
  const router = createRowRouter(memory);
  const rows = [
    { id: "a", variant: "poster" as const, items: items("a", 50) },
    { id: "b", variant: "thumb" as const, items: items("b", 50) },
    { id: "c", variant: "poster" as const, items: items("c", 50) },
  ];
  router.update(rows);
  const destinations: Record<string, unknown[]> = {};
  const views: Record<string, object> = {};
  for (const row of rows) {
    router.registerGuide(row.id, { setDestinations: (list) => (destinations[row.id] = list) });
    for (const item of row.items) {
      views[item.id] = { id: item.id };
      router.registerCard(row.id, item.id, views[item.id]);
    }
  }
  return { memory, router, destinations, views };
}

describe("row router", () => {
  it("points the row above and below at the card nearest the focused card's centre", () => {
    const { memory, router, destinations, views } = setup();
    memory.set("b", 1728);
    memory.set("c", 2624);
    router.focused("b", 11);
    const scale = canvasScale();
    const x = cardCentre("thumb", 11, 1728 / scale);
    const above = nearestCardIndex("poster", 50, memory.get("a") / scale, x);
    const below = nearestCardIndex("poster", 50, 2624 / scale, x);
    expect(destinations.a).toEqual([views[`a-${above}`]]);
    expect(destinations.c).toEqual([views[`c-${below}`]]);
  });

  it("gives the first row no row above and the last no row below", () => {
    const { router, destinations } = setup();
    router.focused("a", 3);
    expect(destinations.b).toHaveLength(1);
    expect(destinations.a).toBeUndefined();
    router.focused("c", 3);
    expect(destinations.c).toBeUndefined();
  });

  it("sets no destination when the nearest card has no view, and forgets a dropped view", () => {
    const { router, destinations } = setup();
    const target = nearestCardIndex("thumb", 50, 0, cardCentre("poster", 3, 0));
    router.registerCard("b", `b-${target}`, null);
    router.focused("a", 3);
    expect(destinations.b).toEqual([]);
  });
});

describe("row router, scrolled", () => {
  it("points the neighbours again when the focused row scrolls after its focus event", () => {
    const { memory, router, destinations, views } = setup();
    memory.set("a", 0);
    router.focused("a", 16);
    memory.set("a", 400);
    router.scrolled("a");
    const x = cardCentre("poster", 16, 400 / canvasScale());
    expect(destinations.b).toEqual([views[`b-${nearestCardIndex("thumb", 50, 0, x)}`]]);
  });

  it("ignores a scroll of a row that does not hold the focused card", () => {
    const { memory, router, destinations } = setup();
    router.focused("a", 5);
    const before = destinations.b;
    memory.set("c", 900);
    router.scrolled("c");
    expect(destinations.b).toBe(before);
  });
});
