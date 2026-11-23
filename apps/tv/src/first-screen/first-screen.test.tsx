// The placeholder reports its tiles to the shell's focus place, and keeps the smoke test's OCTAVE_FOCUS line.
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FocusPlaceContext } from "../design/rows";
import { FirstScreen } from "./FirstScreen";

describe("FirstScreen", () => {
  it("reports the opening view and each focused tile, and logs OCTAVE_FOCUS", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const reporter = { focused: jest.fn(), opening: jest.fn(), rows: jest.fn() };
    await render(
      <FocusPlaceContext.Provider value={reporter}>
        <FirstScreen route={{ kind: "home" }} />
      </FocusPlaceContext.Provider>,
    );
    expect(reporter.opening).toHaveBeenCalled();
    await fireEvent(screen.getByTestId("tile-1"), "focus", { nativeEvent: {} });
    expect(reporter.focused).toHaveBeenCalledWith("tile-1", expect.anything());
    expect(info).toHaveBeenCalledWith("OCTAVE_FOCUS tile-1");
    info.mockRestore();
  });
});
