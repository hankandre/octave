// T3-09 item 5: what Back does, as the pure rule. The shell's own listener is tested in app-shell.test.tsx.
import { describe, expect, it } from "@jest/globals";
import { decideBack } from "./back";
import type { Route } from "./routes";

const ROOTS: Route[] = [{ kind: "home" }, { kind: "search" }, { kind: "library", id: "A" }, { kind: "settings" }, { kind: "accounts" }];
const ANOTHER_ROOT: Route[] = ROOTS.filter((route) => route.kind !== "home");

describe("T3-09 item 5: decideBack, root screens", () => {
  it("T3-09 item 5: with the rail closed, Back on every root screen opens the rail", () => {
    for (const route of ROOTS) expect(decideBack({ route, depth: 1, railOpen: false })).toBe("open-rail");
  });

  it("T3-09 item 5: with the rail open, Back on Home exits", () => {
    expect(decideBack({ route: { kind: "home" }, depth: 1, railOpen: true })).toBe("exit");
  });

  it("T3-09 item 5: with the rail open, Back on every other root screen goes Home", () => {
    for (const route of ANOTHER_ROOT) expect(decideBack({ route, depth: 1, railOpen: true })).toBe("go-home");
  });

  it("T3-09 item 5: only Home exits: no other decision is exit for any root, open or closed", () => {
    for (const route of ROOTS) {
      for (const railOpen of [true, false]) {
        const decision = decideBack({ route, depth: 1, railOpen });
        expect(decision === "exit").toBe(route.kind === "home" && railOpen);
      }
    }
  });
});

describe("T3-09 item 5: decideBack, pushed screens", () => {
  it("T3-09 item 5: with the rail open on a pushed screen, Back closes the rail", () => {
    expect(decideBack({ route: { kind: "item", id: "x" }, depth: 2, railOpen: true })).toBe("close-rail");
  });

  it("T3-09 item 5: with the rail closed on a pushed screen, Back pops", () => {
    expect(decideBack({ route: { kind: "item", id: "x" }, depth: 2, railOpen: false })).toBe("pop");
    expect(decideBack({ route: { kind: "item", id: "x" }, depth: 3, railOpen: false })).toBe("pop");
  });
});

describe("T3-09 item 5: decideBack, not-found and screens without the rail", () => {
  const WITHOUT_RAIL: Route[] = [{ kind: "notFound" }, { kind: "play", id: "x" }, { kind: "signIn" }];

  it("T3-09 item 5: at depth 1, Back goes Home", () => {
    for (const route of WITHOUT_RAIL) expect(decideBack({ route, depth: 1, railOpen: false })).toBe("go-home");
  });

  it("T3-09 item 5: deeper than depth 1, Back pops", () => {
    for (const route of WITHOUT_RAIL) {
      expect(decideBack({ route, depth: 2, railOpen: false })).toBe("pop");
      expect(decideBack({ route, depth: 3, railOpen: false })).toBe("pop");
    }
  });
});
