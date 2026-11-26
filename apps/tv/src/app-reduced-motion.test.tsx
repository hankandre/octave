// The release app's root follows the system's "remove animations" setting (DESIGN.md §5). The host modules need native
// code and AppRoot has its own tests, so both are stood in: what AppRoot would draw reads the setting.
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import App from "./App";

jest.mock("./host/clock", () => ({ hostClock: {} }));
jest.mock("./host/host-sign-in", () => ({ hostSignInServices: {} }));
jest.mock("./host/host-signed-in", () => ({ hostSignedInParts: () => undefined }));
jest.mock("./app-root", () => {
  const { Text } = require("react-native") as typeof import("react-native");
  const { useReducedMotion } = require("./design/motion") as typeof import("./design/motion");
  return { AppRoot: () => <Text testID="reduced-motion">{String(useReducedMotion())}</Text> };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the release app and reduced motion", () => {
  it.each([true, false])("draws the app with the system's setting (%s)", async (isRemoved) => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(isRemoved);

    await render(<App />);
    await act(async () => undefined);

    expect(screen.getByTestId("reduced-motion").props.children).toBe(String(isRemoved));
  });
});
