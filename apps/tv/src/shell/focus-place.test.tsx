// T3-09 item 4: where focus goes when Back returns to a screen, as the pure rule of DESIGN.md §9: the same item in the same
// row, else the card now at the same index (clamped to the row's last card), else the screen's opening focus.
import { describe, expect, it } from "@jest/globals";
import { restoreTarget } from "./focus-place";

function row(id: string, count: number): { id: string; items: { id: string }[] } {
  return { id, items: Array.from({ length: count }, (_, i) => ({ id: `${id}-item-${i}` })) };
}

const SAVED = { rowId: "A", itemId: "A-item-3", index: 3 };

describe("T3-09 item 4: restoreTarget", () => {
  it("T3-09 item 4: the saved item still at its index gives that card", () => {
    expect(restoreTarget(SAVED, [row("A", 10), row("B", 10)])).toEqual({ kind: "card", rowId: "A", index: 3 });
  });

  it("T3-09 item 4: the saved item moved to index 5 gives index 5", () => {
    const moved = { id: "A", items: ["x0", "x1", "x2", "x3", "x4", "A-item-3", "x6"].map((id) => ({ id })) };
    expect(restoreTarget(SAVED, [moved, row("B", 10)])).toEqual({ kind: "card", rowId: "A", index: 5 });
  });

  it("T3-09 item 4: the saved item gone from a row of 10 cards gives the card now at index 3", () => {
    const without = { id: "A", items: Array.from({ length: 10 }, (_, i) => ({ id: `other-${i}` })) };
    expect(restoreTarget(SAVED, [without])).toEqual({ kind: "card", rowId: "A", index: 3 });
  });

  it("T3-09 item 4: the saved item gone from a row of 2 cards gives the last card, index 1", () => {
    const short = { id: "A", items: [{ id: "other-0" }, { id: "other-1" }] };
    expect(restoreTarget(SAVED, [short])).toEqual({ kind: "card", rowId: "A", index: 1 });
  });

  it("T3-09 item 4: the saved row gone gives the opening focus", () => {
    expect(restoreTarget(SAVED, [row("B", 10)])).toEqual({ kind: "opening" });
    expect(restoreTarget(SAVED, [])).toEqual({ kind: "opening" });
  });

  it("T3-09 item 4: the saved row empty gives the opening focus", () => {
    expect(restoreTarget(SAVED, [{ id: "A", items: [] }, row("B", 10)])).toEqual({ kind: "opening" });
  });

  it("T3-09 item 4: nothing saved gives the opening focus", () => {
    expect(restoreTarget(undefined, [row("A", 10)])).toEqual({ kind: "opening" });
    expect(restoreTarget(undefined, [])).toEqual({ kind: "opening" });
  });

  it("T3-09 item 4: the item found in the saved row wins over the same item id in another row", () => {
    const other = { id: "B", items: [{ id: "A-item-3" }] };
    expect(restoreTarget(SAVED, [other, row("A", 10)])).toEqual({ kind: "card", rowId: "A", index: 3 });
  });
});
