// T4-03 item 7 (docs/specs/T4-03.md, D7): a server with Quick Connect off or not built goes straight to the password step,
// drawn with the chosen server's address, and the password step's sign-in is the same hand-off.
//
// Testing contract (the implementer builds to it)
// - `SignInApp` takes optional `passwordStep` and `onSignedIn` beside `services` and `nextStep`. `passwordStep` gets
//   `{ chosen, changeServer, onSignedIn }`.
// - `PasswordPending` (./password-pending) holds the slot until T4-04.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { Text, View } from "react-native";
import { FakeClock } from "@octave/core/src/ports/fake-clock";
import { Button } from "../design/controls/button";
import { ReducedMotionProvider } from "../design/motion";
import { PasswordPending } from "./password-pending";
import { createQuickConnectStep } from "./quick-connect-step";
import { SignInApp } from "./sign-in-app";
import { ChosenServerContext, type PasswordStepProps, type SignedIn } from "./sign-in-services";
import { SignInStepFrame } from "./sign-in-step-frame";
import {
  captureBack,
  focusClaim,
  forgetFocus,
  found,
  makeRig,
  press,
  settle,
  textIn,
  typeAddress,
} from "./test-support/sign-in-doubles";
import { CONNECT, ENABLED, INITIATE, QuickConnectTransport, SERVER_ID, chooseServer, gatewaysFor, httpStatus, ok } from "./test-support/quick-connect-doubles";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

const ALPHA = "https://alpha.example.test";

let back: () => Promise<boolean | null | undefined>;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  forgetFocus();
  back = captureBack().back;
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const handedOver: SignedIn[] = [];
const givenToThePasswordStep: PasswordStepProps[] = [];

function FakePasswordStep(props: PasswordStepProps) {
  givenToThePasswordStep.push(props);
  return (
    <SignInStepFrame heading="Fake password step">
      <View testID="fake-password-step">
        <Text>{props.chosen.address}</Text>
        <Button testID="fake-password-sign-in" label="Sign in" onPress={() => props.onSignedIn({ gateway: props.chosen.gateway, serverName: props.chosen.serverName })} />
        <Button testID="fake-password-change" label="Change server" variant="quiet" onPress={props.changeServer} />
      </View>
    </SignInStepFrame>
  );
}

async function renderFlow(arrange: (transport: QuickConnectTransport) => void) {
  givenToThePasswordStep.length = 0;
  handedOver.length = 0;
  const transport = new QuickConnectTransport();
  arrange(transport);
  const rig = makeRig({ servers: [found(SERVER_ID, ALPHA, "Fixture Server")], gateways: gatewaysFor(transport) });
  const QuickConnect = createQuickConnectStep({ clock: new FakeClock(0) });
  await render(
    <ReducedMotionProvider value>
      <SignInApp services={rig.services} nextStep={QuickConnect} passwordStep={FakePasswordStep as ComponentType<PasswordStepProps>} onSignedIn={(signedIn: SignedIn) => handedOver.push(signedIn)} />
    </ReducedMotionProvider>,
  );
  await settle();
  return { transport };
}

const OFF: Array<[string, (transport: QuickConnectTransport) => void]> = [
  ["Enabled answers false", (transport) => transport.script(ENABLED, ok(false))],
  ["Quick Connect is not built (404)", (transport) => transport.script(ENABLED, httpStatus(404))],
  ["Initiate answers 401", (transport) => transport.script(INITIATE, httpStatus(401))],
];

describe("T4-03 item 7: with Quick Connect off or not built, password sign-in opens", () => {
  it.each(OFF)("T4-03 item 7: when %s the password step opens for the chosen server, with no code", async (_name, arrange) => {
    const { transport } = await renderFlow(arrange);

    await press("server-row-0");

    expect(screen.getByTestId("fake-password-step")).toBeTruthy();
    expect(textIn("sign-in-origin-chip")).toBe(ALPHA);
    expect(screen.queryByTestId("sign-in-qr")).toBeNull();
    expect(screen.queryByTestId("sign-in-code")).toBeNull();
    expect(screen.queryByTestId("sign-in-quick-connect")).toBeNull();
    expect(givenToThePasswordStep.at(-1)?.chosen).toMatchObject({ serverName: "Fixture Server", address: ALPHA });
    expect(transport.count(CONNECT)).toBe(0);
    expect(transport.signIns).toEqual([]);
  });

  it.each(OFF)("T4-03 item 7: when %s, Back on the password step returns to the server list on the row that was chosen", async (_name, arrange) => {
    await renderFlow(arrange);
    await press("server-row-0");
    forgetFocus();

    expect(await back()).toBe(true);

    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(screen.queryByTestId("fake-password-step")).toBeNull();
    expect(focusClaim()).toBe("server-row-0");
  });

  it("T4-03 item 7: Back after a typed address returns to the address field", async () => {
    await renderFlow((transport) => transport.script(ENABLED, ok(false)));
    await press("sign-in-enter-address");
    await typeAddress(ALPHA);
    expect(screen.getByTestId("fake-password-step")).toBeTruthy();
    forgetFocus();

    await back();

    expect(focusClaim()).toBe("sign-in-address");
  });

  it("T4-03 item 7: Change server on the password step returns to step 1", async () => {
    await renderFlow((transport) => transport.script(ENABLED, ok(false)));
    await press("server-row-0");

    await press("fake-password-change");

    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
  });

  it("T4-03 item 7: a sign-in on the password step reaches the app the same way", async () => {
    await renderFlow((transport) => transport.script(ENABLED, ok(false)));
    await press("server-row-0");

    await press("fake-password-sign-in");

    expect(handedOver).toHaveLength(1);
    expect(handedOver[0]?.serverName).toBe("Fixture Server");
    expect(handedOver[0]?.gateway.serverUrl).toBe(ALPHA);
  });

  it("T4-03 item 7: until the password step exists, the slot says so and offers Change server, focused", async () => {
    const transport = new QuickConnectTransport();
    const chosen = await chooseServer(ALPHA, transport);
    const changeServer = jest.fn();
    await render(
      <ReducedMotionProvider value>
        <ChosenServerContext.Provider value={chosen}>
          <PasswordPending chosen={chosen} changeServer={changeServer} onSignedIn={() => undefined} />
        </ChosenServerContext.Provider>
      </ReducedMotionProvider>,
    );
    await settle();

    expect(screen.getByRole("header", { name: "Who is signing in?" })).toBeTruthy();
    expect(screen.getByText("Not available yet.")).toBeTruthy();
    expect(screen.queryByText(/Quick Connect is off/)).toBeNull();
    expect(textIn("sign-in-origin-chip")).toBe(ALPHA);
    expect(screen.getAllByRole("button").map((button) => button.props.accessibilityLabel)).toEqual(["Change server"]);
    expect(focusClaim()).toBe("sign-in-change-server");

    await press("sign-in-change-server");
    expect(changeServer).toHaveBeenCalledTimes(1);
  });
});
