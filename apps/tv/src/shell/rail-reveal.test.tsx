// T3-40 item 3: where the rail's scrolling group moves to keep a focused entry and its ring in view.
//
// Contract: `revealOffset({ offset, top, height, room, viewport, content })` from ./rail-reveal returns the scroll offset
// closest to `offset` that keeps [top - room, top + height + room] inside the viewport, within [0, content - viewport]
// (0 when the content is shorter than the viewport). All lengths share one unit; `top` is in content coordinates.
import { describe, expect, it } from "@jest/globals";
import { revealOffset } from "./rail-reveal";

const list = { height: 64, room: 8, viewport: 400, content: 1000 };

describe("T3-40 item 3: revealing a focused rail entry", () => {
  it("T3-40 item 3: an entry already in view with its room does not move the list", () => {
    expect(revealOffset({ ...list, offset: 100, top: 200 })).toBe(100);
  });

  it("T3-40 item 3: an entry above the view comes down just far enough to keep its room above it", () => {
    expect(revealOffset({ ...list, offset: 300, top: 224 })).toBe(216);
  });

  it("T3-40 item 3: an entry below the view comes up just far enough to keep its room below it", () => {
    expect(revealOffset({ ...list, offset: 100, top: 440 })).toBe(112);
  });

  it("T3-40 item 3: an entry flush with the view's edge still moves to keep its ring whole", () => {
    expect(revealOffset({ ...list, offset: 224, top: 224 })).toBe(216);
  });

  it("T3-40 item 3: the first entry stops at the start of the list", () => {
    expect(revealOffset({ ...list, offset: 300, top: 4 })).toBe(0);
  });

  it("T3-40 item 3: the last entry stops at the end of the list", () => {
    expect(revealOffset({ ...list, offset: 0, top: 936 })).toBe(600);
  });

  it("T3-40 item 3: a list shorter than its view never scrolls", () => {
    expect(revealOffset({ ...list, content: 300, offset: 0, top: 228 })).toBe(0);
  });
});
