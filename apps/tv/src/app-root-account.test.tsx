// T4-05 item 9 (docs/specs/T4-05.md, D7, D9): when an account becomes active (a finished sign-in, or a restore that ends
// signed-in) the root activates it once with the gateway, so the account's settings follow it (App.tsx wires `activate` to
// hostPreferences().useAccount(accountPreferenceSourceOf(gateway))). No other restore outcome activates anything. Sign-out
// logs the gateway out, then deactivates the account (useAccount(undefined)), then shows sign-in's first step. A
// rejection from either is dropped.
//
// The testing contract is in test-support/restore-root-doubles.tsx.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, screen } from "@testing-library/react-native";
import type { ServerConnection } from "@octave/core/src/domain/server-connection";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { Button } from "./design/controls/button";
import { resetFocusBridge } from "./shell/test-support/focus-bridge-double";
import type { NextStepProps } from "./sign-in/sign-in-services";
import { SignInStepFrame } from "./sign-in/sign-in-step-frame";
import { SignedInApp } from "./signed-in/signed-in-app";
import { SERVER_NAME, fakeGateway } from "./signed-in/test-support/signed-in-doubles";
import { SERVER_ID } from "./sign-in/test-support/quick-connect-doubles";
import { captureBack, found, makeRig, press, settle } from "./sign-in/test-support/sign-in-doubles";
import { makeParts, renderRoot, signInOver, type Account, type RestoreOutcome } from "./test-support/restore-root-doubles";

jest.mock("@shopify/flash-list", () => require("./design/rows/test-support/flash-list-double"));
jest.mock("./shell/focus-bridge", () => require("./shell/test-support/focus-bridge-double"));
jest.mock("./signed-in/signed-in-app", () => {
  const actual = jest.requireActual("./signed-in/signed-in-app") as typeof import("./signed-in/signed-in-app");
  return { ...actual, SignedInApp: jest.fn(actual.SignedInApp) };
});

const drawnSignedInApp = jest.mocked(SignedInApp);
const ALPHA = "https://alpha.example.test";

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

/** A signed-in gateway double that records its logout in `order`. */
function signedInGateway(order: string[] = [], logout: () => Promise<void> = async () => undefined): JellyfinGateway {
  return {
    ...fakeGateway(),
    logout: jest.fn(async () => {
      order.push("logout");
      await logout();
    }),
  } as unknown as JellyfinGateway;
}

type Activate = (gateway: JellyfinGateway) => Promise<void>;

function account(order: string[] = [], activate: Activate = async () => undefined) {
  const accounts = {
    activate: jest.fn<Activate>(async (gateway) => {
      order.push("activate");
      await activate(gateway);
    }),
    deactivate: jest.fn(async () => {
      order.push("deactivate");
    }),
  };
  return accounts satisfies Account;
}

/** A later step that finishes the sign-in with `gateway` on one press. */
function approvingStep(gateway: JellyfinGateway) {
  return function Step({ onSignedIn }: NextStepProps) {
    return (
      <SignInStepFrame heading="Fake Quick Connect">
        <Button testID="fake-approve" label="Approve" onPress={() => onSignedIn?.({ gateway, serverName: SERVER_NAME })} />
      </SignInStepFrame>
    );
  };
}

function chooseRig() {
  const rig = makeRig({ servers: [found(SERVER_ID, ALPHA, "Alpha")] });
  rig.transport.answer(ALPHA, { status: 200, body: { ServerName: "Alpha", Version: "10.11.11", Id: SERVER_ID } });
  return rig;
}

/** The props the signed-in app was last drawn with, its signOut included. */
const signedInProps = () => drawnSignedInApp.mock.calls.at(-1)?.[0] as (Parameters<typeof SignedInApp>[0] & { signOut?: () => Promise<void> | void }) | undefined;

describe("T4-05 item 9: the active account's settings follow it", () => {
  it("T4-05 item 9: a finished sign-in activates the account once with its gateway", async () => {
    const gateway = signedInGateway();
    const accounts = account();
    const { SignIn } = signInOver(chooseRig().services, approvingStep(gateway));
    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), account: accounts });
    expect(accounts.activate).not.toHaveBeenCalled();

    await press("server-row-0");
    await press("fake-approve");

    expect(screen.getByTestId("screen-home")).toBeTruthy();
    expect(accounts.activate).toHaveBeenCalledTimes(1);
    expect(accounts.activate.mock.calls[0]?.[0]).toBe(gateway);
    expect(accounts.deactivate).not.toHaveBeenCalled();
  });

  it("T4-05 item 9: a restore that ends signed-in activates the account once with its gateway", async () => {
    const gateway = signedInGateway();
    const accounts = account();
    const { SignIn } = signInOver(makeRig().services, () => null);

    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), account: accounts, restore: async () => ({ kind: "signed-in", gateway, serverName: SERVER_NAME }) });

    expect(screen.getByTestId("screen-home")).toBeTruthy();
    expect(accounts.activate).toHaveBeenCalledTimes(1);
    expect(accounts.activate.mock.calls[0]?.[0]).toBe(gateway);
  });

  it.each([
    ["none", async (): Promise<RestoreOutcome> => ({ kind: "none" })],
    ["unavailable", async (): Promise<RestoreOutcome> => ({ kind: "unavailable", address: ALPHA, failure: "unreachable" })],
    [
      "sign-in-again",
      async (): Promise<RestoreOutcome> => ({
        kind: "sign-in-again",
        gateway: signedInGateway(),
        connection: { name: "Alpha", id: SERVER_ID, version: "10.11.11", hostClass: "public", needsUnencryptedConfirmation: false } as ServerConnection,
        userName: "Louise",
      }),
    ],
    ["a rejection", async (): Promise<RestoreOutcome> => Promise.reject(new Error("fixture rejection"))],
  ])("T4-05 item 9: a restore that ends %s activates nothing", async (_name, outcome) => {
    const accounts = account();
    const restore = jest.fn(outcome);
    const { SignIn } = signInOver(makeRig().services, () => null);

    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), account: accounts, restore });

    expect(restore).toHaveBeenCalledTimes(1);
    expect(accounts.activate).not.toHaveBeenCalled();
    expect(accounts.deactivate).not.toHaveBeenCalled();
  });

  it("T4-05 item 9: sign-out logs out, then deactivates the account, then shows sign-in's first step", async () => {
    const order: string[] = [];
    const gateway = signedInGateway(order);
    const accounts = account(order);
    const { SignIn } = signInOver(makeRig().services, () => null);
    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), account: accounts, restore: async () => ({ kind: "signed-in", gateway, serverName: SERVER_NAME }) });
    const signOut = signedInProps()?.signOut;
    expect(typeof signOut).toBe("function");

    await act(async () => {
      await signOut?.();
    });
    await settle();

    expect(order).toEqual(["activate", "logout", "deactivate"]);
    expect(accounts.deactivate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(screen.queryByTestId("screen-home")).toBeNull();
  });

  it("T4-05 item 9: a rejected activation is dropped and Home still opens", async () => {
    const gateway = signedInGateway();
    const accounts = account([], async () => Promise.reject(new Error("fixture rejection")));
    const { SignIn } = signInOver(makeRig().services, () => null);

    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), account: accounts, restore: async () => ({ kind: "signed-in", gateway, serverName: SERVER_NAME }) });

    expect(screen.getByTestId("screen-home")).toBeTruthy();
    expect(accounts.activate).toHaveBeenCalledTimes(1);
  });
});
