// T5-09 item 4: a row's end. The list ends `space.safeX` after its last card's box, so the focus scroll can leave that card
// 96 canvas px in, and the end fade is off only while the last card has focus. Jest draws no fade and scrolls nothing, so
// the card's position and the drawn fade are the task's emulator evidence. FlashList is the T3-08 double.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { PixelRatio, StyleSheet, type ViewStyle } from "react-native";
import { ReducedMotionProvider } from "../motion";
import { px } from "../scale";
import { space } from "../tokens";
import { MediaRow } from "./media-row";
import { createRowMemory, type RowMemory } from "./row-memory";
import { fixtureItems } from "./test-support/fixtures";
import { resetScrollCalls, scrollCalls } from "./test-support/flash-list-double";

jest.mock("@shopify/flash-list", () => require("./test-support/flash-list-double"));

beforeEach(() => {
  resetScrollCalls();
});

const event = { nativeEvent: {} };
const FADED = { start: 0, end: px(space.safeX) };
const NO_FADE = { start: 0, end: 0 };

type Variant = "poster" | "thumb";

async function renderRow(variant: Variant, count: number, memory: RowMemory = createRowMemory()) {
  return await render(
    <ReducedMotionProvider value>
      <MediaRow testID="r" rowId="row-a" title="Row A" variant={variant} items={fixtureItems("row-a", count)} memory={memory} />
    </ReducedMotionProvider>,
  );
}

const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as ViewStyle) ?? {}) as ViewStyle;
const fade = (): unknown => screen.getByTestId("r-list").props.fadingEdgeLength;
const card = (index: number) => screen.getByTestId(`r-card-${index}`);
const focusCard = (index: number) => fireEvent(card(index), "focus", event);
const blurCard = (index: number) => fireEvent(card(index), "blur", event);

describe("T5-09 item 4: a row ends 96 px after its last card", () => {
  it.each<Variant>(["poster", "thumb"])("T5-09 item 4: a %s row's end padding plus its last cell's padding is the safe margin", async (variant) => {
    await renderRow(variant, 12);
    const cell = card(11).parent;
    if (cell === null) throw new Error("the last card has no cell");
    const cellEnd = flat(cell.props.style).paddingRight;
    const listEnd = flat(screen.getByTestId("r-list").props.contentContainerStyle).paddingRight;
    expect(typeof cellEnd).toBe("number");
    expect(typeof listEnd).toBe("number");
    expect(Math.abs((listEnd as number) + (cellEnd as number) - px(space.safeX))).toBeLessThanOrEqual(1 / PixelRatio.get());
  });
});

describe("T5-09 item 4: a focused last card is not under the fade", () => {
  it.each<Variant>(["poster", "thumb"])("T5-09 item 4: a %s row fades its end at rest, not while its last card has focus, and again after that card blurs", async (variant) => {
    await renderRow(variant, 12);
    expect(fade()).toEqual(FADED);
    await focusCard(11);
    expect(fade()).toEqual(NO_FADE);
    await blurCard(11);
    expect(fade()).toEqual(FADED);
  });

  it("T5-09 item 4: focus moving from the last card to another card brings the fade back", async () => {
    await renderRow("thumb", 8);
    await focusCard(7);
    expect(fade()).toEqual(NO_FADE);
    await blurCard(7);
    await focusCard(6);
    expect(fade()).toEqual(FADED);
    await blurCard(6);
    await focusCard(7);
    expect(fade()).toEqual(NO_FADE);
    await focusCard(6);
    expect(fade()).toEqual(FADED);
  });

  it("T5-09 item 4: a card that is not the last keeps the fade while focused", async () => {
    await renderRow("poster", 12);
    for (const index of [0, 5, 10]) {
      await focusCard(index);
      expect(fade()).toEqual(FADED);
      await blurCard(index);
    }
    await focusCard(11);
    expect(fade()).toEqual(NO_FADE);
  });

  it("T5-09 item 4: a row of one card shows no fade while it has focus", async () => {
    await renderRow("thumb", 1);
    expect(fade()).toEqual(FADED);
    await focusCard(0);
    expect(fade()).toEqual(NO_FADE);
    await blurCard(0);
    expect(fade()).toEqual(FADED);
  });

  it("T5-09 item 4: turning the fade off and on scrolls nothing and keeps the row's remembered place", async () => {
    const memory = createRowMemory();
    await renderRow("poster", 12, memory);
    const offset = px(space.safeX) * 10;
    await fireEvent.scroll(screen.getByTestId("r-list"), { nativeEvent: { contentOffset: { x: offset, y: 0 } } });
    resetScrollCalls();
    await focusCard(11);
    expect(fade()).toEqual(NO_FADE);
    await blurCard(11);
    expect(fade()).toEqual(FADED);
    expect(scrollCalls("r-list")).toEqual([]);
    expect(memory.get("row-a")).toBe(offset);
  });
});
