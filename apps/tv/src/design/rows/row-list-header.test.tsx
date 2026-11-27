// T5-09 item 2 (the rows' half): the header asks the vertical list to show itself. It scrolls that list to its top at once
// and changes nothing else: no row guide is cleared or pointed and no row scrolls. The row router is the T3-09 spy and
// FlashList the T3-08 double.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { createRef } from "react";
import { Text } from "react-native";
import { resetRouters, routers } from "../../shell/test-support/row-router-spy";
import { ReducedMotionProvider } from "../motion";
import { RowList, type RowListEntry, type RowSpec } from "./row-list";
import { createRowMemory } from "./row-memory";
import { fixtureItems } from "./test-support/fixtures";
import { resetScrollCalls, scrollCalls } from "./test-support/flash-list-double";

jest.mock("@shopify/flash-list", () => require("./test-support/flash-list-double"));
jest.mock("./row-router", () => require("../../shell/test-support/row-router-spy"));

beforeEach(() => {
  resetRouters();
  resetScrollCalls();
});

const ROWS: RowSpec[] = [
  { id: "alpha", title: "Alpha row", variant: "thumb", items: fixtureItems("alpha", 6) },
  { id: "beta", title: "Beta row", variant: "poster", items: fixtureItems("beta", 8) },
];

describe("T5-09 item 2: the rows reveal their header", () => {
  it("T5-09 item 2: revealHeader scrolls the vertical list to its top at once and touches no row", async () => {
    const entryRef = createRef<RowListEntry | null>() as { current: RowListEntry | null };
    await render(
      <ReducedMotionProvider value>
        <RowList testID="l" rows={ROWS} memory={createRowMemory()} header={<Text>Header</Text>} entryRef={entryRef} />
      </ReducedMotionProvider>,
    );
    await fireEvent(screen.getByTestId("l-row-alpha-card-3"), "focus", { nativeEvent: {} });
    const router = routers().at(-1);
    if (router === undefined) throw new Error("no row router was created");
    const destinations = () => ROWS.map((row) => router.destinationCalls(row.id).length);
    const before = { destinations: destinations(), clears: router.clear.mock.calls.length };
    resetScrollCalls();

    entryRef.current?.revealHeader();

    expect(scrollCalls("l-list")).toEqual([{ offset: 0, animated: false }]);
    expect(destinations()).toEqual(before.destinations);
    expect(router.clear.mock.calls.length).toBe(before.clears);
    for (const row of ROWS) expect(scrollCalls(`l-row-${row.id}-list`)).toEqual([]);
  });
});
