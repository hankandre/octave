// T4-04 items 2, 3, 4 and 6 (docs/specs/T4-04.md, D4, D5, D8): the password step alone, over the real gateway and a
// scripted transport. The testing contract is in test-support/password-doubles.tsx.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { TransportError } from "@octave/core/src/ports/transport";
import { ReducedMotionProvider } from "../design/motion";
import { PasswordStep } from "./password-step";
import { ChosenServerContext, SignInServicesContext, type ChosenServer, type SignedIn } from "./sign-in-services";
import { COPY, LAN, PLANTED_PASSWORD, QuickConnectTransport, everyProp, gatewaysFor } from "./test-support/quick-connect-doubles";
import { captureBack, focusClaim, forgetFocus, makeRig, preferredFocus, press, settle, statusText, textIn } from "./test-support/sign-in-doubles";
import { HeldSignInTransport, consoleSpy, focusSentTo, submitField, typeInto } from "./test-support/password-doubles";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

const ALPHA = "https://alpha.example.test";
const USER = "Louise";

const WRONG = "That username and password didn't work.";
const REFUSED = "This account can't sign in right now. Try again later. If it still doesn't work, ask the server's owner.";

const USERNAME_INPUT = "sign-in-username-input";
const PASSWORD_INPUT = "sign-in-password-input";

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  forgetFocus();
  captureBack();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

type Options = { server?: string; confirm?: boolean; transport?: QuickConnectTransport };

async function renderStep(options: Options = {}) {
  const transport = options.transport ?? new QuickConnectTransport();
  const rig = makeRig({ gateways: gatewaysFor(transport) });
  const gateway = await rig.gateways(options.server ?? ALPHA, { confirmations: rig.confirmations });
  await gateway.connect();
  if (options.confirm !== false) gateway.confirmUnencryptedConnection();
  const chosen: ChosenServer = { gateway, serverName: "Fixture Server", address: gateway.serverUrl };
  const changeServer = jest.fn();
  const onSignedIn = jest.fn<(signedIn: SignedIn) => void>();
  await render(
    <ReducedMotionProvider value>
      <SignInServicesContext.Provider value={rig.services}>
        <ChosenServerContext.Provider value={chosen}>
          <PasswordStep chosen={chosen} changeServer={changeServer} onSignedIn={onSignedIn} />
        </ChosenServerContext.Provider>
      </SignInServicesContext.Provider>
    </ReducedMotionProvider>,
  );
  await settle();
  return { transport, stores: rig, chosen, changeServer, onSignedIn };
}

const inputProps = (testID: string) => screen.getByTestId(testID).props as Record<string, unknown>;
const valueOf = (testID: string): unknown => inputProps(testID).value;
const credentials = (transport: QuickConnectTransport) => transport.signIns.map((signIn) => signIn.credential);
const passwordCredential = (password: string, username = USER) => ({ kind: "password", username, password });

/** Types the name and password and presses Sign in. */
async function signIn(password: string, username = USER): Promise<void> {
  await typeInto(USERNAME_INPUT, username);
  if (password !== "") await typeInto(PASSWORD_INPUT, password);
  await press("sign-in-submit");
}

/** The two habitual ways to send again: the keyboard's action key on the emptied field, and Sign in. */
const HABIT: Array<[string, () => Promise<void>]> = [
  ["the Password field's action key", () => submitField(PASSWORD_INPUT)],
  ["Sign in", () => press("sign-in-submit")],
];

describe("T4-04 item 2: the system keyboard types the fields, and its last action key submits", () => {
  it("T4-04 item 2: the step asks who is signing in for the chosen server and opens on Username", async () => {
    const rig = await renderStep();

    expect(screen.getByTestId("sign-in-password-step")).toBeTruthy();
    expect(screen.getByRole("header", { name: "Who is signing in?" })).toBeTruthy();
    expect(textIn("sign-in-origin-chip")).toBe(ALPHA);
    expect(screen.getByText("Username")).toBeTruthy();
    expect(screen.getByText("Password")).toBeTruthy();
    expect(textIn("sign-in-submit")).toBe("Sign in");
    expect(textIn("sign-in-change-server")).toBe("Change server");
    expect(preferredFocus()).toEqual(["sign-in-username"]);

    await press("sign-in-change-server");
    expect(rig.changeServer).toHaveBeenCalledTimes(1);
  });

  it.each([
    [USERNAME_INPUT, "next"],
    [PASSWORD_INPUT, "go"],
  ])("T4-04 item 2: %s opens the system keyboard with the %s action, with no capitals, correction or autofill", async (testID, action) => {
    await renderStep();

    expect(inputProps(testID)).toMatchObject({ returnKeyType: action, autoCapitalize: "none", autoCorrect: false, importantForAutofill: "no" });
    expect(inputProps(testID).showSoftInputOnFocus).not.toBe(false);
  });

  it("T4-04 item 2: the action key on Username moves focus to Password and sends nothing", async () => {
    const rig = await renderStep();
    await typeInto(USERNAME_INPUT, USER);
    forgetFocus();

    await submitField(USERNAME_INPUT);

    expect(focusSentTo()).toBe("sign-in-password");
    expect(rig.transport.signIns).toEqual([]);
  });

  it.each(HABIT)("T4-04 item 2: %s signs in once with the typed name and password", async (_name, send) => {
    const rig = await renderStep();
    await typeInto(USERNAME_INPUT, USER);
    await typeInto(PASSWORD_INPUT, PLANTED_PASSWORD);

    await send();

    expect(credentials(rig.transport)).toEqual([passwordCredential(PLANTED_PASSWORD)]);
    expect(rig.onSignedIn).toHaveBeenCalledTimes(1);
    expect(rig.onSignedIn.mock.calls[0]?.[0]).toStrictEqual({ gateway: rig.chosen.gateway, serverName: "Fixture Server" });
  });

  it.each(HABIT)("T4-04 item 2: with no username, %s sends nothing and focuses Username", async (_name, send) => {
    const rig = await renderStep();
    await typeInto(PASSWORD_INPUT, PLANTED_PASSWORD);
    forgetFocus();

    await send();

    expect(rig.transport.signIns).toEqual([]);
    expect(focusSentTo()).toBe("sign-in-username");
    expect(screen.queryByTestId("sign-in-failure")).toBeNull();
  });

  it("T4-04 item 2: an account with no password signs in, and the name is sent as typed", async () => {
    const rig = await renderStep();

    await signIn("", " Louise ");

    expect(credentials(rig.transport)).toEqual([passwordCredential("", " Louise ")]);
    expect(rig.onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("T4-04 item 2: while it signs in, the step says it is loading and a second send does nothing", async () => {
    const transport = new HeldSignInTransport();
    const rig = await renderStep({ transport });
    await signIn(PLANTED_PASSWORD);

    expect(statusText()).toBe(COPY.loading);
    expect(screen.getByTestId("sign-in-status").props.accessibilityLiveRegion).toBe("polite");

    await press("sign-in-submit");
    await submitField(PASSWORD_INPUT);

    expect(transport.signIns).toHaveLength(1);
    await transport.release();
    expect(statusText()).toBeUndefined();
    expect(rig.onSignedIn).toHaveBeenCalledTimes(1);
  });
});

describe("T4-04 item 3: a failed sign-in shows Octave's sentence and keeps the username", () => {
  it("T4-04 item 3: a wrong name or password shows its sentence once, keeps the name and focuses the emptied Password field", async () => {
    const transport = new QuickConnectTransport();
    transport.signInAnswer = new TransportError("status", 401);
    const rig = await renderStep({ transport });
    forgetFocus();

    await signIn(PLANTED_PASSWORD);

    expect(textIn("sign-in-failure")).toBe(WRONG);
    expect(screen.getByTestId("sign-in-failure").props.accessibilityLiveRegion).toBe("polite");
    expect(valueOf(USERNAME_INPUT)).toBe(USER);
    expect(valueOf(PASSWORD_INPUT)).toBe("");
    expect(focusClaim()).toBe("sign-in-password");
    expect(statusText()).toBeUndefined();
    expect(rig.onSignedIn).not.toHaveBeenCalled();
  });

  it.each([
    ["a network failure", new TransportError("network"), COPY.unreachable(ALPHA), "sign-in-password"],
    ["a redirect", new TransportError("redirect"), COPY.redirect, "sign-in-change-server"],
    ["a 500", new TransportError("status", 500), COPY.other, "sign-in-password"],
    ["a 403", new TransportError("status", 403), REFUSED, "sign-in-password"],
  ])("T4-04 item 3: %s shows its sentence, keeps the name, clears the password and moves focus", async (_name, error, sentence, focused) => {
    const transport = new QuickConnectTransport();
    transport.signInAnswer = error;
    const rig = await renderStep({ transport });
    forgetFocus();

    await signIn(PLANTED_PASSWORD);

    expect(textIn("sign-in-failure")).toBe(sentence);
    expect(valueOf(USERNAME_INPUT)).toBe(USER);
    expect(valueOf(PASSWORD_INPUT)).toBe("");
    expect(focusSentTo()).toBe(focused);
    expect(rig.onSignedIn).not.toHaveBeenCalled();
  });

  it("T4-04 item 3: an unconfirmed private-network server gets no password, and the step says something went wrong", async () => {
    const rig = await renderStep({ server: LAN, confirm: false });

    await signIn(PLANTED_PASSWORD);

    expect(rig.transport.signIns).toEqual([]);
    expect(textIn("sign-in-failure")).toBe(COPY.other);
  });

  it("T4-04 item 3: a cancelled sign-in shows nothing and is not a failure", async () => {
    const transport = new QuickConnectTransport();
    transport.signInAnswer = new TransportError("cancelled");
    await renderStep({ transport });

    await signIn(PLANTED_PASSWORD);

    expect(transport.signIns).toHaveLength(1);
    expect(screen.queryByTestId("sign-in-failure")).toBeNull();
    expect(valueOf(PASSWORD_INPUT)).toBe("");

    await press("sign-in-submit");
    expect(credentials(transport)).toEqual([passwordCredential(PLANTED_PASSWORD), passwordCredential("")]);
  });
});

type Refusal = { name: string; status: number; sentence: string };

const REFUSALS: Refusal[] = [
  { name: "a 401", status: 401, sentence: WRONG },
  { name: "a 403", status: 403, sentence: REFUSED },
];

/** Both habitual sends leave the server alone, keep the sentence and put focus back on the Password field. */
async function expectHeld(transport: QuickConnectTransport, sentence: string): Promise<void> {
  const sent = transport.signIns.length;
  for (const [, send] of HABIT) {
    forgetFocus();

    await send();

    expect(transport.signIns).toHaveLength(sent);
    expect(textIn("sign-in-failure")).toBe(sentence);
    expect(focusSentTo()).toBe("sign-in-password");
  }
}

/** A step whose first try, with `password`, got `error`. */
async function failedTry(error: TransportError, password: string) {
  const transport = new QuickConnectTransport();
  transport.signInAnswer = error;
  const rig = await renderStep({ transport });
  await signIn(password);
  expect(credentials(transport)).toEqual([passwordCredential(password)]);
  return rig;
}

describe("T4-04 item 3: the step never sends an empty password it emptied itself", () => {
  it.each(REFUSALS)("T4-04 item 3: after $name on a typed password, nothing is sent until a field is edited", async ({ status, sentence }) => {
    const rig = await failedTry(new TransportError("status", status), PLANTED_PASSWORD);

    await expectHeld(rig.transport, sentence);
  });

  it.each(REFUSALS.flatMap((refusal) => HABIT.map(([key, send]) => ({ ...refusal, key, send }))))(
    "T4-04 item 3: after $name, typing in Username lets $key send once, then holds again",
    async ({ status, sentence, send }) => {
      const rig = await failedTry(new TransportError("status", status), PLANTED_PASSWORD);

      await typeInto(USERNAME_INPUT, "Louisa");
      await send();

      expect(credentials(rig.transport)).toEqual([passwordCredential(PLANTED_PASSWORD), passwordCredential("", "Louisa")]);
      await expectHeld(rig.transport, sentence);
    },
  );

  it.each(REFUSALS)("T4-04 item 3: after $name, typing and clearing Password sends one empty password", async ({ status }) => {
    const rig = await failedTry(new TransportError("status", status), PLANTED_PASSWORD);

    await typeInto(PASSWORD_INPUT, "x");
    await typeInto(PASSWORD_INPUT, "");
    await press("sign-in-submit");

    expect(credentials(rig.transport)).toEqual([passwordCredential(PLANTED_PASSWORD), passwordCredential("")]);
  });

  it.each(REFUSALS)("T4-04 item 3: after $name on a try with an empty password, that try is not sent again", async ({ status, sentence }) => {
    const rig = await failedTry(new TransportError("status", status), "");

    await expectHeld(rig.transport, sentence);
  });

  it("T4-04 item 3: after a network failure on a typed password, nothing is sent", async () => {
    const rig = await failedTry(new TransportError("network"), PLANTED_PASSWORD);

    await expectHeld(rig.transport, COPY.unreachable(ALPHA));
  });

  // No verdict reached Octave, or none on the password, and the empty password is the viewer's own.
  it.each(
    [
      { name: "a network failure", error: new TransportError("network") },
      { name: "a timeout", error: new TransportError("timeout") },
      { name: "a 500", error: new TransportError("status", 500) },
    ].flatMap((failure) => HABIT.map(([key, send]) => ({ ...failure, key, send }))),
  )("T4-04 item 3: after $name on a try with an empty password, $key sends that try again", async ({ error, send }) => {
    const rig = await failedTry(error, "");

    await send();

    expect(credentials(rig.transport)).toEqual([passwordCredential(""), passwordCredential("")]);
  });
});

describe("T4-04 item 4: the password is gone once the request returns", () => {
  const ANSWERS: Array<[string, TransportError | undefined]> = [
    ["a 401", new TransportError("status", 401)],
    ["a network failure", new TransportError("network")],
    ["a success", undefined],
  ];

  it.each(ANSWERS)("T4-04 item 4: after %s the password is not drawn, logged, stored or put in a request", async (_name, error) => {
    const logged = consoleSpy();
    const transport = new QuickConnectTransport();
    if (error !== undefined) transport.signInAnswer = error;
    // A private-network server, so that a confirmation is stored.
    const rig = await renderStep({ server: LAN, transport });
    await typeInto(USERNAME_INPUT, USER);
    await typeInto(PASSWORD_INPUT, PLANTED_PASSWORD);
    expect(everyProp()).toContain(PLANTED_PASSWORD);

    await press("sign-in-submit");

    expect(valueOf(PASSWORD_INPUT)).toBe("");
    expect(everyProp()).not.toContain(PLANTED_PASSWORD);
    expect(logged.everything()).not.toContain(PLANTED_PASSWORD);
    expect(rig.stores.confirm).toHaveBeenCalled();
    expect(JSON.stringify([rig.stores.remembered.list(), rig.stores.confirm.mock.calls])).not.toContain(PLANTED_PASSWORD);
    for (const { path, query, body } of transport.requests) expect(JSON.stringify({ path, query, body })).not.toContain(PLANTED_PASSWORD);
    expect(transport.signIns.filter((sent) => JSON.stringify(sent.credential).includes(PLANTED_PASSWORD))).toHaveLength(1);
    for (const { server, deviceId } of transport.signIns) expect(`${server} ${deviceId}`).not.toContain(PLANTED_PASSWORD);
    expect(rig.onSignedIn).toHaveBeenCalledTimes(error === undefined ? 1 : 0);
  });
});

describe("T4-04 item 6: Show password", () => {
  const shownState = () => screen.getByTestId("sign-in-show-password").props.accessibilityState as { checked?: boolean };

  it("T4-04 item 6: the step opens with the password hidden and the switch off", async () => {
    await renderStep();

    expect(screen.getByText("Show password")).toBeTruthy();
    expect(screen.getByTestId("sign-in-show-password").props.accessibilityLabel).toBe("Show password");
    expect(inputProps(PASSWORD_INPUT).secureTextEntry).toBe(true);
    expect(shownState().checked).toBe(false);
    expect(textIn("sign-in-show-password")).toBe("Off");
  });

  it("T4-04 item 6: one press shows the typed password as a visible password, and a second hides it", async () => {
    await renderStep();
    await typeInto(PASSWORD_INPUT, PLANTED_PASSWORD);

    await press("sign-in-show-password");

    expect(inputProps(PASSWORD_INPUT)).toMatchObject({ secureTextEntry: false, keyboardType: "visible-password", value: PLANTED_PASSWORD });
    expect(shownState().checked).toBe(true);
    expect(textIn("sign-in-show-password")).toBe("On");

    await press("sign-in-show-password");

    expect(inputProps(PASSWORD_INPUT)).toMatchObject({ secureTextEntry: true, keyboardType: "default", value: PLANTED_PASSWORD });
    expect(shownState().checked).toBe(false);
    expect(textIn("sign-in-show-password")).toBe("Off");
  });
});
