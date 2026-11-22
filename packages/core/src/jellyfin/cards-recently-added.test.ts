import { describe, expect, it } from "vitest";
import { toRecentlyAdded } from "./cards";

// T5-02 review: one bad entry in the Latest answer is skipped; the rest of the row stays.
describe("toRecentlyAdded with a malformed entry", () => {
  it("skips a null entry and keeps the movie after it", () => {
    const items = [null, { Id: "m1", Name: "A Movie", Type: "Movie" }] as unknown as Parameters<typeof toRecentlyAdded>[0];
    expect(toRecentlyAdded(items, 15).map((card) => card.id)).toEqual(["m1"]);
  });
});
