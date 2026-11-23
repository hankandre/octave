// RowList reports each card focus and its rows handle to the focus place (T3-09).
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FocusPlaceContext, type RowsHandle } from "./focus-place-context";
import { RowList } from "./row-list";
import { createRowMemory } from "./row-memory";
import { fixtureItems } from "./test-support/fixtures";

jest.mock("@shopify/flash-list", () => require("./test-support/flash-list-double"));

describe("RowList and the focus place", () => {
  it("registers a rows handle, reports a card focus with its view, and drops the handle on unmount", async () => {
    const reporter = { focused: jest.fn(), opening: jest.fn(), rows: jest.fn() };
    const memory = createRowMemory();
    const rows = [{ id: "A", title: "Row A", variant: "poster" as const, items: fixtureItems("A", 4) }];
    const view = await render(
      <FocusPlaceContext.Provider value={reporter}>
        <RowList testID="l" rows={rows} memory={memory} />
      </FocusPlaceContext.Provider>,
    );
    const handle = reporter.rows.mock.calls[0]?.[0] as RowsHandle;
    expect(handle.rows()).toEqual([expect.objectContaining({ id: "A" })]);
    await fireEvent(screen.getByTestId("l-row-A-card-2"), "focus", { nativeEvent: {} });
    expect(reporter.focused).toHaveBeenCalledWith("card:A:A-item-2", expect.anything(), { rowId: "A", itemId: "A-item-2", index: 2 });
    expect(handle.viewOf("A", "A-item-2")).toBeDefined();
    await view.unmount();
    expect(reporter.rows).toHaveBeenLastCalledWith(null);
  });
});
