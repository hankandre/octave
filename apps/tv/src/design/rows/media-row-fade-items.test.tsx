// A row's end fade is off only while its last card has focus (T5-09). The row's items can change while that card has focus (a
// refresh adds some), so the card that loses focus is no longer the last: the fade must come back all the same. FlashList is the
// T3-08 double.
import { expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ReducedMotionProvider } from "../motion";
import { px } from "../scale";
import { space } from "../tokens";
import { MediaRow } from "./media-row";
import { createRowMemory } from "./row-memory";
import { fixtureItems } from "./test-support/fixtures";

jest.mock("@shopify/flash-list", () => require("./test-support/flash-list-double"));

const event = { nativeEvent: {} };
const fade = (): unknown => screen.getByTestId("r-list").props.fadingEdgeLength;

it("the end fade returns when the focused card stops being the last one and then loses focus", async () => {
  const memory = createRowMemory();
  const row = (count: number) => (
    <ReducedMotionProvider value>
      <MediaRow testID="r" rowId="row-a" title="Row A" variant="poster" items={fixtureItems("row-a", count)} memory={memory} />
    </ReducedMotionProvider>
  );
  const view = await render(row(3));
  await fireEvent(screen.getByTestId("r-card-2"), "focus", event);
  expect(fade()).toEqual({ start: 0, end: 0 });

  await view.rerender(row(5));
  await fireEvent(screen.getByTestId("r-card-2"), "blur", event);

  expect(fade()).toEqual({ start: 0, end: px(space.safeX) });
});
