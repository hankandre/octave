// T3-09 item 7: the not-found state shows the owner's words exactly (DESIGN.md §10; decisions-owner-inbox-2026-11-23b §1).
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { NotFoundScreen } from "./not-found-screen";
import { ShellContext } from "./shell-context";

describe("NotFoundScreen", () => {
  it("shows the owner's title, message and one Go home action that opens Home", async () => {
    const open = jest.fn();
    await render(
      <ShellContext.Provider value={{ open, route: { kind: "notFound" } }}>
        <NotFoundScreen />
      </ShellContext.Provider>,
    );
    expect(screen.getByText("This page isn't available")).toBeTruthy();
    expect(screen.getByText("It may have moved, or this account can't see it.")).toBeTruthy();
    expect(screen.getByText("Go home")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("not-found-home"));
    expect(open).toHaveBeenCalledWith({ kind: "home" });
  });
});
