// T4-03 items 3 and 9 (docs/specs/T4-03.md, D7, D8): the app root shows the signed-out flow until a sign-in finishes, then
// the signed-in app built for that session, and leaving the Quick Connect step stops its polling.
//
// Testing contract (the implementer builds to it)
// - `AppRoot` (./app-root) takes `{ signIn, signedInParts }`. `signIn` is a component that gets `onSignedIn`;
//   `signedInParts(signedIn)` answers the props of `SignedInApp`, and is asked once per sign-in.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { View } from "react-native";
import { createFakePlayerEngine } from "@octave/core/src/player/fake-player-engine";
import { FakeClock } from "@octave/core/src/ports/fake-clock";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { AppRoot } from "./app-root";
import { Button } from "./design/controls/button";
import { ReducedMotionProvider } from "./design/motion";
import { pressSelect } from "./design/test-support/select-key";
import { NOW } from "./home/test-support/home-doubles";
import { resetFocusBridge } from "./shell/test-support/focus-bridge-double";
import { createQuickConnectStep } from "./sign-in/quick-connect-step";
import { SignInApp } from "./sign-in/sign-in-app";
import type { NextStepProps, PasswordStepProps, SignedIn, SignInServices } from "./sign-in/sign-in-services";
import { SignInStepFrame } from "./sign-in/sign-in-step-frame";
import { SignedInApp, type SignedInAppProps } from "./signed-in/signed-in-app";
import { SERVER_NAME, SESSION_ID, fakeGateway, settle } from "./signed-in/test-support/signed-in-doubles";
import { captureBack, found, makeRig, press } from "./sign-in/test-support/sign-in-doubles";
import { CONNECT, INTERVAL, QuickConnectTransport, SERVER_ID, approved, gatewaysFor, wait } from "./sign-in/test-support/quick-connect-doubles";

jest.mock("@shopify/flash-list", () => require("./design/rows/test-support/flash-list-double"));
jest.mock("./shell/focus-bridge", () => require("./shell/test-support/focus-bridge-double"));
jest.mock("./signed-in/signed-in-app", () => {
  const actual = jest.requireActual("./signed-in/signed-in-app") as typeof import("./signed-in/signed-in-app");
  return { ...actual, SignedInApp: jest.fn(actual.SignedInApp) };
});

const drawnSignedInApp = jest.mocked(SignedInApp);
const ALPHA = "https://alpha.example.test";

let back: () => Promise<boolean | null | undefined>;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
  drawnSignedInApp.mockClear();
  back = captureBack().back;
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function makeParts() {
  const player = createFakePlayerEngine();
  const launch = jest.spyOn(player.engine, "launch");
  const parts = jest.fn(
    (signedIn: SignedIn): SignedInAppProps => ({
      gateway: signedIn.gateway,
      serverName: signedIn.serverName,
      engine: player.engine,
      PlayerView: View,
      clock: new FakeClock(NOW),
    }),
  );
  return { parts, launch };
}

async function renderRoot(services: SignInServices, steps: { nextStep: ComponentType<NextStepProps>; passwordStep: ComponentType<PasswordStepProps> }, parts: (signedIn: SignedIn) => SignedInAppProps) {
  function SignIn({ onSignedIn }: { onSignedIn(signedIn: SignedIn): void }) {
    return <SignInApp services={services} nextStep={steps.nextStep} passwordStep={steps.passwordStep} onSignedIn={onSignedIn} />;
  }
  const root = (
    <ReducedMotionProvider value>
      <AppRoot signIn={SignIn} signedInParts={parts} />
    </ReducedMotionProvider>
  );
  const view = await render(root);
  await settle();
  return { view, root };
}

const expectSignedOut = (): void => {
  expect(screen.queryByTestId("rail")).toBeNull();
  expect(screen.queryByTestId("screen-home")).toBeNull();
};

const NoStep = () => null;

describe("T4-03 item 9: a finished sign-in mounts the signed-in app", () => {
  // The gateway each fake step reports: a signed-in server double, which Home reads and plays from.
  const signedInGateway = () => fakeGateway() as unknown as JellyfinGateway;

  function FakeQuickConnect(gateway: JellyfinGateway) {
    return function Step({ onSignedIn }: NextStepProps) {
      return (
        <SignInStepFrame heading="Fake Quick Connect">
          <Button testID="fake-quick-connect-approve" label="Approve" onPress={() => onSignedIn?.({ gateway, serverName: SERVER_NAME })} />
        </SignInStepFrame>
      );
    };
  }

  function FakeOpensPassword({ openPassword }: NextStepProps) {
    return (
      <SignInStepFrame heading="Fake Quick Connect">
        <Button testID="fake-quick-connect-password" label="Use a password" onPress={() => openPassword?.()} />
      </SignInStepFrame>
    );
  }

  function FakePassword(gateway: JellyfinGateway) {
    return function Step({ onSignedIn }: PasswordStepProps) {
      return (
        <SignInStepFrame heading="Fake password">
          <Button testID="fake-password-sign-in" label="Sign in" onPress={() => onSignedIn({ gateway, serverName: SERVER_NAME })} />
        </SignInStepFrame>
      );
    };
  }

  function chooseRig() {
    const rig = makeRig({ servers: [found(SERVER_ID, ALPHA, "Alpha")] });
    rig.transport.answer(ALPHA, { status: 200, body: { ServerName: "Alpha", Version: "10.11.11", Id: SERVER_ID } });
    return rig;
  }

  const paths = [
    {
      name: "Quick Connect",
      steps: (gateway: JellyfinGateway) => ({ nextStep: FakeQuickConnect(gateway), passwordStep: NoStep as ComponentType<PasswordStepProps> }),
      finish: ["server-row-0", "fake-quick-connect-approve"],
    },
    {
      name: "the password step",
      steps: (gateway: JellyfinGateway) => ({ nextStep: FakeOpensPassword, passwordStep: FakePassword(gateway) }),
      finish: ["server-row-0", "fake-quick-connect-password", "fake-password-sign-in"],
    },
  ];

  it.each(paths)("T4-03 item 9: a sign-in through $name opens Home with that gateway and server name, and Home plays", async ({ steps, finish }) => {
    const gateway = signedInGateway();
    const rig = makeParts();
    await renderRoot(chooseRig().services, steps(gateway), rig.parts);

    for (const control of finish.slice(0, -1)) {
      expectSignedOut();
      await press(control);
    }
    expectSignedOut();
    expect(rig.parts).not.toHaveBeenCalled();
    await press(String(finish.at(-1)));
    await settle();

    expect(screen.getByTestId("screen-home")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-server-step")).toBeNull();
    expect(rig.parts.mock.calls.at(-1)?.[0]).toStrictEqual({ gateway, serverName: SERVER_NAME });
    expect(drawnSignedInApp.mock.calls.at(-1)?.[0].gateway).toBe(gateway);
    expect(drawnSignedInApp.mock.calls.at(-1)?.[0].serverName).toBe(SERVER_NAME);

    await pressSelect(screen.getByTestId("home-hero-primary"));
    await settle();

    expect(rig.launch).toHaveBeenCalledTimes(1);
    expect(rig.launch.mock.calls[0]?.[0]).toMatchObject({ sessionId: SESSION_ID });
  });

  it("T4-03 item 9: the parts are built once for a sign-in, however often the app redraws", async () => {
    const gateway = signedInGateway();
    const rig = makeParts();
    const { view, root } = await renderRoot(chooseRig().services, { nextStep: FakeQuickConnect(gateway), passwordStep: NoStep as ComponentType<PasswordStepProps> }, rig.parts);
    await press("server-row-0");
    await press("fake-quick-connect-approve");
    await settle();

    await view.rerender(root);
    await settle();

    expect(rig.parts).toHaveBeenCalledTimes(1);
  });
});

describe("T4-03 item 3: approval opens Home, and leaving the step stops the polling", () => {
  async function renderQuickConnect(arrange: (transport: QuickConnectTransport) => void = () => undefined) {
    const transport = new QuickConnectTransport();
    arrange(transport);
    const clock = new FakeClock(1_000_000);
    const rig = makeRig({ servers: [found(SERVER_ID, ALPHA, "Fixture Server")], gateways: gatewaysFor(transport) });
    const parts = makeParts();
    await renderRoot(rig.services, { nextStep: createQuickConnectStep({ clock }), passwordStep: NoStep as ComponentType<PasswordStepProps> }, parts.parts);
    await press("server-row-0");
    return { transport, clock, parts };
  }

  it("T4-03 item 3: once the phone approves, Home is drawn, the step is gone, and the new session is kept", async () => {
    const { transport, clock, parts } = await renderQuickConnect((scripted) => scripted.script(CONNECT, approved()));
    expectSignedOut();

    await wait(clock, INTERVAL);
    await settle();

    expect(screen.getByTestId("screen-home")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-quick-connect")).toBeNull();
    const handed = parts.parts.mock.calls.at(-1)?.[0];
    expect(handed?.serverName).toBe("Fixture Server");
    expect(handed?.gateway.sessionId()).toBe("session-1");
    expect(transport.ended).toEqual([]);
    const polls = transport.count(CONNECT);
    await wait(clock, 60_000);
    expect(transport.count(CONNECT)).toBe(polls);
  });

  it("T4-03 item 3: Change server on the step ends the polling", async () => {
    const { transport, clock } = await renderQuickConnect();
    await wait(clock, INTERVAL);
    expect(transport.count(CONNECT)).toBe(1);

    await press("sign-in-change-server");
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    const sent = transport.total();
    await wait(clock, 60_000);

    expect(transport.total()).toBe(sent);
  });

  it("T4-03 item 3: Back on the step ends the polling", async () => {
    const { transport, clock } = await renderQuickConnect();
    await wait(clock, INTERVAL);
    expect(transport.count(CONNECT)).toBe(1);

    await back();
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    const sent = transport.total();
    await wait(clock, 60_000);

    expect(transport.total()).toBe(sent);
  });
});
