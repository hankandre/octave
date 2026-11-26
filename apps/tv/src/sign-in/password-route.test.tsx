// T4-04 items 1, 3, 4, 5 and 6 (docs/specs/T4-04.md, D3, D6, D7, D8): the routes to the password step and back, through
// the sign-in flow with the real Quick Connect step and the real password step over a scripted transport.
//
// Testing contract (the implementer builds to it)
// - `SignInServices.signInMethods?(chosen)` answers a `SignInMethods`; without it password sign-in is offered.
// - testIDs are listed in test-support/password-doubles.tsx.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { SignInMethods } from "@octave/core/src/domain/sign-in-methods";
import { FakeClock } from "@octave/core/src/ports/fake-clock";
import { TransportError, type TransportResponse } from "@octave/core/src/ports/transport";
import { ReducedMotionProvider } from "../design/motion";
import { colors } from "../design/tokens";
import { PasswordStep } from "./password-step";
import { createQuickConnectStep } from "./quick-connect-step";
import { SignInApp } from "./sign-in-app";
import type { ChosenServer, SignedIn } from "./sign-in-services";
import { CONNECT, ENABLED, INITIATE, INTERVAL, NEW_CODE, PLANTED_PASSWORD, SERVER_ID, QuickConnectTransport, gatewaysFor, httpStatus, ok, pending, wait } from "./test-support/quick-connect-doubles";
import { captureBack, deferred, focusClaim, forgetFocus, found, makeRig, press, settle, statusText, textIn } from "./test-support/sign-in-doubles";
import { HeldSignInTransport, focusSentTo, submitField, typeInto } from "./test-support/password-doubles";

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

type Options = {
  arrange?: (transport: QuickConnectTransport) => void;
  transport?: QuickConnectTransport;
  signInMethods?: (chosen: ChosenServer) => SignInMethods;
};

/** The flow with one found server, which is chosen. */
async function chooseInFlow(options: Options = {}) {
  const transport = options.transport ?? new QuickConnectTransport();
  options.arrange?.(transport);
  const rig = makeRig({ servers: [found(SERVER_ID, ALPHA, "Fixture Server")], gateways: gatewaysFor(transport) });
  const clock = new FakeClock(1_000_000);
  const QuickConnect = createQuickConnectStep({ clock });
  const onSignedIn = jest.fn<(signedIn: SignedIn) => void>();
  const services = { ...rig.services, ...(options.signInMethods === undefined ? {} : { signInMethods: options.signInMethods }) };
  await render(
    <ReducedMotionProvider value>
      <SignInApp services={services} nextStep={QuickConnect} passwordStep={PasswordStep} onSignedIn={onSignedIn} />
    </ReducedMotionProvider>,
  );
  await settle();
  await press("server-row-0");
  return { transport, clock, onSignedIn };
}

const drawn = (testID: string): boolean => screen.queryByTestId(testID) !== null;
const buttonIds = (): string[] => screen.getAllByRole("button").map((button) => String(button.props.testID));
const flatStyle = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style as never) as Record<string, unknown>;

describe("T4-04 item 1: Use a password is a secondary action on the Quick Connect step", () => {
  it("T4-04 item 1: with Quick Connect on, its step comes first, with Use a password secondary, focused and before Change server", async () => {
    await chooseInFlow();

    expect(drawn("sign-in-quick-connect")).toBe(true);
    expect(drawn("sign-in-password-step")).toBe(false);
    expect(buttonIds()).toEqual(["sign-in-use-password", "sign-in-change-server"]);
    expect(textIn("sign-in-use-password")).toBe("Use a password");
    expect(flatStyle("sign-in-use-password-scale").backgroundColor).toBe(colors.fillSecondary);
    const label = screen.getByText("Use a password");
    expect(StyleSheet.flatten(label.props.style as never)).toMatchObject({ color: colors.text1 });
    expect(focusClaim()).toBe("sign-in-use-password");
  });

  it("T4-04 item 1: one press opens the password step for the chosen server and stops the polling", async () => {
    const rig = await chooseInFlow();

    await press("sign-in-use-password");

    expect(drawn("sign-in-password-step")).toBe(true);
    expect(drawn("sign-in-quick-connect")).toBe(false);
    expect(textIn("sign-in-origin-chip")).toBe(ALPHA);
    const polls = rig.transport.count(CONNECT);
    await wait(rig.clock, 60_000);
    expect(rig.transport.count(CONNECT)).toBe(polls);
    expect(rig.transport.signIns).toEqual([]);
  });

  it("T4-04 item 1: Back from the password step returns to a new code with focus on Use a password", async () => {
    const rig = await chooseInFlow();
    await press("sign-in-use-password");
    forgetFocus();

    expect(await back()).toBe(true);

    expect(drawn("sign-in-quick-connect")).toBe(true);
    expect(drawn("sign-in-password-step")).toBe(false);
    expect(textIn("sign-in-code")).toBe(`${NEW_CODE.slice(0, 3)} ${NEW_CODE.slice(3)}`);
    expect(rig.transport.count(INITIATE)).toBe(2);
    expect(focusClaim()).toBe("sign-in-use-password");
  });

  it("T4-04 item 1: Change server on the password step returns to step 1", async () => {
    await chooseInFlow();
    await press("sign-in-use-password");

    await press("sign-in-change-server");

    expect(drawn("sign-in-server-step")).toBe(true);
    expect(drawn("sign-in-password-step")).toBe(false);
  });

  it("T4-04 item 1: with Quick Connect off, the password step comes first", async () => {
    const rig = await chooseInFlow({ arrange: (transport) => transport.script(ENABLED, ok(false)) });

    expect(drawn("sign-in-password-step")).toBe(true);
    expect(drawn("sign-in-quick-connect")).toBe(false);
    expect(rig.transport.count(INITIATE)).toBe(0);
  });

  it("T4-04 item 1: a redirect offers no password, which would hit the same redirect", async () => {
    await chooseInFlow({ arrange: (transport) => transport.script(INITIATE, new TransportError("redirect")) });

    expect(buttonIds()).toEqual(["sign-in-change-server"]);
    expect(focusClaim()).toBe("sign-in-change-server");
  });

  it("T4-04 item 1: after Get a new code, focus goes to Use a password", async () => {
    const rig = await chooseInFlow({ arrange: (transport) => transport.script(CONNECT, httpStatus(404), pending()) });
    await wait(rig.clock, INTERVAL);
    expect(buttonIds()).toEqual(["sign-in-new-code", "sign-in-use-password", "sign-in-change-server"]);
    expect(focusClaim()).toBe("sign-in-new-code");
    forgetFocus();

    await press("sign-in-new-code");

    expect(focusSentTo()).toBe("sign-in-use-password");
  });

  it("T4-04 item 1: after Try again, focus goes to Use a password", async () => {
    await chooseInFlow({ arrange: (transport) => transport.script(INITIATE, new TransportError("network"), ok({ Secret: "0".repeat(64), Code: NEW_CODE })) });
    expect(buttonIds()).toEqual(["sign-in-try-again", "sign-in-use-password", "sign-in-change-server"]);
    expect(focusClaim()).toBe("sign-in-try-again");
    forgetFocus();

    await press("sign-in-try-again");

    expect(focusSentTo()).toBe("sign-in-use-password");
  });

  it("T4-04 item 1: pressed before the server says Quick Connect is off, it takes two Backs to reach step 1", async () => {
    const slow = deferred<TransportResponse>();
    await chooseInFlow({ arrange: (transport) => transport.script(ENABLED, slow.promise, ok(false)) });
    expect(statusText()).toBe("Loading…");

    await press("sign-in-use-password");

    expect(drawn("sign-in-password-step")).toBe(true);

    await back();

    expect(drawn("sign-in-password-step")).toBe(true);
    expect(drawn("sign-in-server-step")).toBe(false);

    await back();

    expect(drawn("sign-in-server-step")).toBe(true);
    expect(drawn("sign-in-password-step")).toBe(false);
  });
});

describe("T4-04 item 3: reopening the step sends nothing by habit", () => {
  const REOPEN: Array<[string, () => Promise<void>]> = [
    [
      "Back and Use a password",
      async () => {
        await back();
        await press("sign-in-use-password");
      },
    ],
    [
      "Change server and choosing it again",
      async () => {
        await press("sign-in-change-server");
        await press("server-row-0");
        await press("sign-in-use-password");
      },
    ],
  ];

  it.each(REOPEN)("T4-04 item 3: after a wrong password, %s opens an empty step that sends nothing until a name is typed", async (_name, reopen) => {
    const rig = await chooseInFlow({
      arrange: (transport) => {
        transport.signInAnswer = new TransportError("status", 401);
      },
    });
    await press("sign-in-use-password");
    await typeInto("sign-in-username-input", "Louise");
    await typeInto("sign-in-password-input", PLANTED_PASSWORD);
    await press("sign-in-submit");
    expect(rig.transport.signIns).toHaveLength(1);

    await reopen();

    expect(screen.getByTestId("sign-in-username-input").props.value).toBe("");
    expect(screen.queryByTestId("sign-in-failure")).toBeNull();
    for (const send of [() => submitField("sign-in-password-input"), () => press("sign-in-submit")]) {
      forgetFocus();
      await send();
      expect(focusSentTo()).toBe("sign-in-username");
    }
    expect(rig.transport.signIns).toHaveLength(1);
  });
});

describe("T4-04 item 4: leaving the step abandons its sign-in", () => {
  const LEAVE: Array<[string, () => Promise<unknown>]> = [
    ["Back", () => back()],
    ["Change server", () => press("sign-in-change-server")],
  ];

  it.each(LEAVE)("T4-04 item 4: %s aborts a sign-in in flight, and a late success signs nobody in", async (_name, leave) => {
    const transport = new HeldSignInTransport();
    const rig = await chooseInFlow({ transport });
    await press("sign-in-use-password");
    await typeInto("sign-in-username-input", "Louise");
    await typeInto("sign-in-password-input", PLANTED_PASSWORD);
    await press("sign-in-submit");
    expect(transport.signIns).toHaveLength(1);
    expect(transport.signIns[0]?.signal?.aborted).toBe(false);

    await leave();

    expect(drawn("sign-in-password-step")).toBe(false);
    expect(transport.signIns[0]?.signal?.aborted).toBe(true);

    await transport.release();

    expect(rig.onSignedIn).not.toHaveBeenCalled();
    expect(transport.ended).toEqual(["session-late"]);
  });
});

describe("T4-04 item 5: one sign-in methods value draws both password routes", () => {
  const HIDDEN = (): SignInMethods => ({ password: "hidden" });

  it("T4-04 item 5: with no sign-in methods given, Use a password is offered", async () => {
    await chooseInFlow();

    expect(drawn("sign-in-use-password")).toBe(true);
  });

  it("T4-04 item 5: with no sign-in methods given, Quick Connect off opens the password step", async () => {
    await chooseInFlow({ arrange: (transport) => transport.script(ENABLED, ok(false)) });

    expect(drawn("sign-in-password-step")).toBe(true);
  });

  it("T4-04 item 5: with the password hidden, Use a password is not drawn", async () => {
    await chooseInFlow({ signInMethods: HIDDEN });

    expect(drawn("sign-in-code")).toBe(true);
    expect(drawn("sign-in-use-password")).toBe(false);
    expect(focusClaim()).toBe("sign-in-change-server");
  });

  it("T4-04 item 5: with the password hidden, Quick Connect off opens no password step", async () => {
    await chooseInFlow({ signInMethods: HIDDEN, arrange: (transport) => transport.script(ENABLED, ok(false)) });

    expect(drawn("sign-in-quick-connect")).toBe(true);
    expect(drawn("sign-in-password-step")).toBe(false);
    expect(drawn("sign-in-use-password")).toBe(false);
  });

  it("T4-04 item 5: the value is asked for the chosen server, once each time a server is chosen", async () => {
    const signInMethods = jest.fn((_chosen: ChosenServer): SignInMethods => ({ password: "offered" }));
    await chooseInFlow({ signInMethods });

    expect(signInMethods).toHaveBeenCalledTimes(1);
    expect(signInMethods.mock.calls[0]?.[0]).toMatchObject({ serverName: "Fixture Server", address: ALPHA });

    await press("sign-in-use-password");
    await back();
    expect(signInMethods).toHaveBeenCalledTimes(1);

    await press("sign-in-change-server");
    await press("server-row-0");
    expect(signInMethods).toHaveBeenCalledTimes(2);
  });
});

describe("T4-04 item 6: Show password is off whenever the step opens", () => {
  async function turnOn(): Promise<void> {
    await press("sign-in-use-password");
    await press("sign-in-show-password");
    expect(screen.getByTestId("sign-in-password-input").props.secureTextEntry).toBe(false);
  }

  function expectOff(): void {
    expect(screen.getByTestId("sign-in-password-input").props.secureTextEntry).toBe(true);
    expect(screen.getByTestId("sign-in-show-password").props.accessibilityState).toMatchObject({ checked: false });
    expect(textIn("sign-in-show-password")).toBe("Off");
  }

  it("T4-04 item 6: after Back and Use a password again, it is off", async () => {
    await chooseInFlow();
    await turnOn();

    await back();
    await press("sign-in-use-password");

    expectOff();
  });

  it("T4-04 item 6: after Change server and choosing the server again, it is off", async () => {
    await chooseInFlow();
    await turnOn();

    await press("sign-in-change-server");
    await press("server-row-0");
    await press("sign-in-use-password");

    expectOff();
  });
});
