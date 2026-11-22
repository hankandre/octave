// T3-08 item 3: Up and Down land on the adjacent row's card nearest the same horizontal position. (a) is the rule as a
// pure function, the oracle for milestone 5 and T3-10. (b) is the structure that leaves vertical focus to the native
// engine. Jest has no focus engine, so the real moves are on the emulator. All geometry values are canvas px.
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import type { ReactElement } from "react";
import { ReducedMotionProvider } from "../motion";
import { sizes } from "../tokens";
import { cardGap, nearestCardIndex, rowInsetStart } from "./row-geometry";
import { RowList } from "./row-list";
import type { RowSpec } from "./row-list";
import { createRowMemory } from "./row-memory";
import { fixtureItems } from "./test-support/fixtures";

jest.mock("@shopify/flash-list", () => require("./test-support/flash-list-double"));

type Variant = "poster" | "thumb";

const widthOf = (variant: Variant): number => (variant === "poster" ? sizes.posterW : sizes.thumbW);
const strideOf = (variant: Variant): number => widthOf(variant) + cardGap;
/** Expected centre, computed here from the tokens and the exported inset and gap. */
const centre = (variant: Variant, index: number, offset: number): number => rowInsetStart + index * strideOf(variant) + widthOf(variant) / 2 - offset;

/** The rule, spelled out: the card whose centre is nearest x, a tie going to the lower index. */
function expectedNearest(variant: Variant, count: number, offset: number, x: number): number {
  let best = 0;
  for (let i = 1; i < count; i += 1) {
    if (Math.abs(centre(variant, i, offset) - x) < Math.abs(centre(variant, best, offset) - x)) best = i;
  }
  return best;
}

const COUNT = 50;

describe("T3-08 item 3: nearestCardIndex, the pure rule", () => {
  it("T3-08 item 3: a poster row to a poster row at the same offset gives the same index", () => {
    for (const index of [0, 1, 5, 20, 49]) {
      expect(nearestCardIndex("poster", COUNT, 0, centre("poster", index, 0))).toBe(index);
    }
  });

  it("T3-08 item 3: a poster row to a poster row scrolled by 10 strides gives an index 10 higher", () => {
    const offset = 10 * strideOf("poster");
    expect(nearestCardIndex("poster", COUNT, offset, centre("poster", 5, 0))).toBe(15);
    expect(nearestCardIndex("poster", COUNT, offset, centre("poster", 0, 0))).toBe(10);
  });

  it("T3-08 item 3: poster to thumb and thumb to poster land on the card with the nearest centre, at offsets 0 and mid-card", () => {
    const offsets = [0, widthOf("thumb") / 2, widthOf("poster") / 2];
    for (const [from, to] of [
      ["poster", "thumb"],
      ["thumb", "poster"],
    ] as const) {
      for (const sourceOffset of offsets) {
        for (const targetOffset of offsets) {
          for (const sourceIndex of [0, 1, 2, 7, 13, 30]) {
            const x = centre(from, sourceIndex, sourceOffset);
            expect(nearestCardIndex(to, COUNT, targetOffset, x)).toBe(expectedNearest(to, COUNT, targetOffset, x));
          }
        }
      }
    }
  });

  it("T3-08 item 3: an x exactly between two centres goes to the lower index", () => {
    for (const variant of ["poster", "thumb"] as const) {
      const x = (centre(variant, 2, 0) + centre(variant, 3, 0)) / 2;
      expect(nearestCardIndex(variant, COUNT, 0, x)).toBe(2);
    }
  });

  it("T3-08 item 3: an x past the last card gives the last index and an x before the first gives 0", () => {
    const count = 10;
    for (const variant of ["poster", "thumb"] as const) {
      expect(nearestCardIndex(variant, count, 0, centre(variant, count - 1, 0) + 3 * strideOf(variant))).toBe(count - 1);
      expect(nearestCardIndex(variant, count, 0, centre(variant, 0, 0) - 3 * strideOf(variant))).toBe(0);
      const offset = 4 * strideOf(variant);
      expect(nearestCardIndex(variant, count, offset, centre(variant, count - 1, offset) + 3 * strideOf(variant))).toBe(count - 1);
      expect(nearestCardIndex(variant, count, offset, centre(variant, 0, offset) - 3 * strideOf(variant))).toBe(0);
    }
  });
});

const NEXT_FOCUS_PROPS = ["nextFocusLeft", "nextFocusRight", "nextFocusUp", "nextFocusDown"];

function rows(): RowSpec[] {
  return [
    { id: "alpha", title: "Alpha row", variant: "poster", items: fixtureItems("alpha", 4) },
    { id: "beta", title: "Beta row", variant: "thumb", items: fixtureItems("beta", 4) },
    { id: "gamma", title: "Gamma row", variant: "poster", items: fixtureItems("gamma", 4) },
  ];
}

function list(specs: RowSpec[], header?: ReactElement): ReactElement {
  return (
    <ReducedMotionProvider value>
      <RowList testID="l" rows={specs} memory={createRowMemory()} header={header} />
    </ReducedMotionProvider>
  );
}

describe("T3-08 item 3: the structure leaves vertical focus to the native engine", () => {
  it("T3-08 item 3: apart from the cards nothing in a poster, thumb, poster list is focusable, the header and row titles included", async () => {
    await render(list(rows(), <Text testID="header">Header</Text>));
    const ids = screen.container.queryAll((instance) => instance.props.focusable === true).map((instance) => String(instance.props.testID));
    const expected = ["alpha", "beta", "gamma"].flatMap((id) => Array.from({ length: 4 }, (_, i) => `l-row-${id}-card-${i}`));
    expect(ids).toEqual(expected);
    expect(screen.getByTestId("header").props.focusable).not.toBe(true);
    for (const id of ["alpha", "beta", "gamma"]) expect(screen.getByTestId(`l-row-${id}-title`).props.focusable).not.toBe(true);
  });

  it("T3-08 item 3: no element sets nextFocus*, and no row guide traps Up or Down", async () => {
    await render(list(rows()));
    const overrides = screen.container.queryAll((instance) => NEXT_FOCUS_PROPS.some((name) => instance.props[name] !== undefined));
    expect(overrides).toEqual([]);
    for (const id of ["alpha", "beta", "gamma"]) {
      const guide = screen.getByTestId(`l-row-${id}-guide`);
      expect(guide.props.trapFocusUp).toBeFalsy();
      expect(guide.props.trapFocusDown).toBeFalsy();
    }
  });

  it("T3-08 item 3: an empty row renders nothing, so the next shown row is the adjacent one", async () => {
    const specs = rows();
    specs[1] = { ...specs[1], items: [] };
    await render(list(specs));
    expect(screen.queryByTestId("l-row-beta")).toBeNull();
    expect(screen.queryByTestId("l-row-beta-title")).toBeNull();
    const shown = screen.container.queryAll((instance) => /^l-row-[a-z]+$/.test(String(instance.props.testID))).map((instance) => instance.props.testID);
    expect(shown).toEqual(["l-row-alpha", "l-row-gamma"]);
  });

  it("T3-08 item 3: the vertical list's getItemType returns each row's variant, so a recycled row view keeps its layout", async () => {
    const specs = rows();
    await render(list(specs));
    const getItemType = screen.getByTestId("l-list").props.getItemType as (row: RowSpec, index: number) => unknown;
    expect(specs.map((spec, index) => getItemType(spec, index))).toEqual(["poster", "thumb", "poster"]);
  });
});
