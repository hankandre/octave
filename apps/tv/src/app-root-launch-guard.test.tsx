// T4-05, guardian G-L4 and sweep S-L1: the launch never strands "Loading…", and sign-out runs once. A restore that throws
// synchronously, or an outcome whose settling throws (the signed-in parts cannot be built), opens sign-in's first step.
// Two sign-out calls during a slow logout share one run: Home stays until the logout ends, the account is deactivated
// once, and sign-in's first step opens once.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, screen } from "@testing-library/react-native";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { resetFocusBridge } from "./shell/test-support/focus-bridge-double";
import { SignedInApp } from "./signed-in/signed-in-app";
import { SERVER_NAME, fakeGateway } from "./signed-in/test-support/signed-in-doubles";
import { captureBack, makeRig, settle } from "./sign-in/test-support/sign-in-doubles";
import { makeParts, renderRoot, signInOver, type RestoreOutcome } from "./test-support/restore-root-doubles";

jest.mock("@shopify/flash-list", () => require("./design/rows/test-support/flash-list-double"));
jest.mock("./shell/focus-bridge", () => require("./shell/test-support/focus-bridge-double"));
jest.mock("./signed-in/signed-in-app", () => {
  const actual = jest.requireActual("./signed-in/signed-in-app") as typeof import("./signed-in/signed-in-app");
  return { ...actual, SignedInApp: jest.fn(actual.SignedInApp) };
});

const drawnSignedInApp = jest.mocked(SignedInApp);

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
  drawnSignedInApp.mockClear();
  captureBack();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("T4-05 G-L4: the launch never strands Loading…", () => {
  it("a restore that throws synchronously opens sign-in's first step", async () => {
    const { SignIn } = signInOver(makeRig().services, () => null);
    const restore = (): Promise<RestoreOutcome> => {
      throw new Error("fixture: the module did not load");
    };

    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), restore });

    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(screen.queryByTestId("restore-loading")).toBeNull();
  });

  it("an outcome whose settling throws opens sign-in's first step", async () => {
    const { SignIn } = signInOver(makeRig().services, () => null);
    const gateway = fakeGateway() as unknown as JellyfinGateway;
    const parts = jest.fn(() => {
      throw new Error("fixture: the parts cannot be built");
    });

    await renderRoot({ signIn: SignIn, signedInParts: parts, restore: async () => ({ kind: "signed-in", gateway, serverName: SERVER_NAME }) });

    expect(parts).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(screen.queryByTestId("restore-loading")).toBeNull();
  });
});

describe("T4-05 S-L1: two sign-out calls share one run", () => {
  it("keeps Home until the slow logout ends, then deactivates and opens sign-in once", async () => {
    let finishLogout: () => void = () => undefined;
    const logout = jest.fn(() => new Promise<void>((resolve) => (finishLogout = resolve)));
    const gateway = { ...fakeGateway(), logout } as unknown as JellyfinGateway;
    const account = { activate: jest.fn(async () => undefined), deactivate: jest.fn(async () => undefined) };
    const { SignIn, drawn } = signInOver(makeRig().services, () => null);
    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), account, restore: async () => ({ kind: "signed-in", gateway, serverName: SERVER_NAME }) });
    const signOut = (drawnSignedInApp.mock.calls.at(-1)?.[0] as { signOut?: () => Promise<void> } | undefined)?.signOut;
    expect(typeof signOut).toBe("function");

    let first = false;
    let second = false;
    await act(async () => {
      void signOut?.().then(() => (first = true));
      void signOut?.().then(() => (second = true));
    });
    await settle();

    expect(second).toBe(false);
    expect(screen.getByTestId("screen-home")).toBeTruthy();
    expect(logout).toHaveBeenCalledTimes(1);

    await act(async () => finishLogout());
    await settle();

    expect(first && second).toBe(true);
    expect(account.deactivate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(drawn).toHaveBeenCalled();
  });
});
