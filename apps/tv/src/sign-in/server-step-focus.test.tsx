// T4-02 R13: a server row and the step's field show focus without scaling, so the column never cuts their ring.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ReducedMotionProvider } from "../design/motion";
import { flat, hasTransform } from "../design/test-support/harness";
import { colors } from "../design/tokens";
import { SignInApp } from "./sign-in-app";
import { ID_ONE, captureBack, forgetFocus, found, makeRig, settle, type Rig } from "./test-support/sign-in-doubles";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

const event = { nativeEvent: {} };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  forgetFocus();
  captureBack();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function renderWithMotion(rig: Rig): Promise<void> {
  await render(
    <ReducedMotionProvider value={false}>
      <SignInApp services={rig.services} nextStep={() => null} />
    </ReducedMotionProvider>,
  );
  await settle();
}

async function expectStillFocus(testID: string): Promise<void> {
  const control = screen.getByTestId(testID);
  for (const name of ["focus", "pressIn", "pressOut"]) {
    await fireEvent(control, name, event);
    await settle();
    expect(screen.getByTestId(`${testID}-focus-ring`)).toBeTruthy();
    expect(hasTransform(screen.getByTestId(`${testID}-scale`))).toBe(false);
  }
}

const fillOf = (testID: string): unknown => flat(screen.getByTestId(`${testID}-scale`)).backgroundColor;

describe("T4-02 R13: rows and fields do not lift", () => {
  it("a focused server row has the ring, the surface3 fill and no transform, before and after a press", async () => {
    await renderWithMotion(makeRig({ servers: [found(ID_ONE, "https://alpha.example.test", "Alpha")] }));
    expect(fillOf("server-row-0")).toBe(colors.surface2);
    await expectStillFocus("server-row-0");
    expect(fillOf("server-row-0")).toBe(colors.surface3);
    await fireEvent(screen.getByTestId("server-row-0"), "blur", event);
    expect(fillOf("server-row-0")).toBe(colors.surface2);
  });

  it("the focused Server URL field has the ring and no transform, before and after a press", async () => {
    await renderWithMotion(makeRig({ servers: [] }));
    await expectStillFocus("sign-in-address");
    expect(fillOf("sign-in-address")).toBe(colors.surface2);
  });
});
