// A row steps to the focused card and does not slide, in every motion setting (T5-09): an animated scroll back from a row's end
// can be dropped by the native view. Jest scrolls nothing, so this checks the prop the native list is given. FlashList is the
// T3-08 double.
import { expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { ReducedMotionProvider } from "../motion";
import { MediaRow } from "./media-row";
import { createRowMemory } from "./row-memory";
import { fixtureItems } from "./test-support/fixtures";

jest.mock("@shopify/flash-list", () => require("./test-support/flash-list-double"));

it.each([false, true])("a row's list has no scroll animation with reduced motion %s", async (reducedMotion) => {
  await render(
    <ReducedMotionProvider value={reducedMotion}>
      <MediaRow testID="r" rowId="row-a" title="Row A" variant="poster" items={fixtureItems("row-a", 8)} memory={createRowMemory()} />
    </ReducedMotionProvider>,
  );
  expect(screen.getByTestId("r-list").props.scrollAnimationEnabled).toBe(false);
});
