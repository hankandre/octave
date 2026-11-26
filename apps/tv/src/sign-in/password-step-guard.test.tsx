// T4-04 review follow-ups (not frozen): the ways round the empty-password guard (docs/specs/T4-04.md, R7).
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { TransportError, type SignInRequest, type SignInResult } from "@octave/core/src/ports/transport";
import { ReducedMotionProvider } from "../design/motion";
import { PasswordStep } from "./password-step";
import { ChosenServerContext, SignInServicesContext, type ChosenServer, type SignedIn } from "./sign-in-services";
import { PLANTED_PASSWORD, QuickConnectTransport, gatewaysFor } from "./test-support/quick-connect-doubles";
import { captureBack, forgetFocus, makeRig, press, settle } from "./test-support/sign-in-doubles";
import { submitField, typeInto } from "./test-support/password-doubles";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

const USERNAME_INPUT = "sign-in-username-input";
const PASSWORD_INPUT = "sign-in-password-input";
const SESSION: SignInResult = { session: "session-1", userId: "user-1", userName: "Louise" };

/** Each sign-in stays in flight until the test answers it. */
class AnsweredLaterTransport extends QuickConnectTransport {
  private readonly held: Array<{ resolve: (result: SignInResult) => void; reject: (error: unknown) => void }> = [];

  override signIn(request: SignInRequest): Promise<SignInResult> {
    this.signIns.push(request);
    return new Promise((resolve, reject) => {
      this.held.push({ resolve, reject });
    });
  }

  answer(answer: SignInResult | TransportError): void {
    for (const { resolve, reject } of this.held.splice(0)) {
      if (answer instanceof TransportError) reject(answer);
      else resolve(answer);
    }
  }
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  forgetFocus();
  captureBack();
});
afterEach(() => {
  jest.useRealTimers();
});

async function renderStep() {
  const transport = new AnsweredLaterTransport();
  const rig = makeRig({ gateways: gatewaysFor(transport) });
  const gateway = await rig.gateways("https://alpha.example.test", { confirmations: rig.confirmations });
  await gateway.connect();
  const chosen: ChosenServer = { gateway, serverName: "Fixture Server", address: gateway.serverUrl };
  const onSignedIn = jest.fn<(signedIn: SignedIn) => void>();
  await render(
    <ReducedMotionProvider value>
      <SignInServicesContext.Provider value={rig.services}>
        <ChosenServerContext.Provider value={chosen}>
          <PasswordStep chosen={chosen} changeServer={() => undefined} onSignedIn={onSignedIn} />
        </ChosenServerContext.Provider>
      </SignInServicesContext.Provider>
    </ReducedMotionProvider>,
  );
  await settle();
  return { transport, onSignedIn };
}

const sentPasswords = (transport: QuickConnectTransport) =>
  transport.signIns.map(({ credential }) => (credential.kind === "password" ? credential.password : credential.kind));

async function signIn(password: string): Promise<void> {
  await typeInto(USERNAME_INPUT, "Louise");
  if (password !== "") await typeInto(PASSWORD_INPUT, password);
  await press("sign-in-submit");
}

async function answer(transport: AnsweredLaterTransport, result: SignInResult | TransportError): Promise<void> {
  await act(async () => {
    transport.answer(result);
  });
  await settle();
}

const runMicrotasks = async () => {
  for (let round = 0; round < 25; round += 1) await Promise.resolve();
};

/**
 * Answers the sign-in and then presses "Go" through the handler of the render on screen, before React draws what the
 * answer left: a native event that lands in between. Outside the act environment React schedules that draw on a timer,
 * which is faked.
 */
async function pressBetweenAnswerAndRender(transport: AnsweredLaterTransport, result: SignInResult | TransportError): Promise<void> {
  const staleGo = screen.getByTestId(PASSWORD_INPUT).props.onSubmitEditing as () => void;
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const wasActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = false;
  transport.answer(result);
  await runMicrotasks();
  staleGo();
  await runMicrotasks();
  environment.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
  await settle();
}

describe("a press that lands between the answer and the next render", () => {
  it("sends nothing after a wrong password", async () => {
    const { transport } = await renderStep();
    await signIn(PLANTED_PASSWORD);

    await pressBetweenAnswerAndRender(transport, new TransportError("status", 401));

    expect(sentPasswords(transport)).toEqual([PLANTED_PASSWORD]);
    expect(screen.getByTestId("sign-in-failure")).toBeTruthy();
  });

  it("sends nothing after a success, then or later", async () => {
    const { transport, onSignedIn } = await renderStep();
    await signIn(PLANTED_PASSWORD);

    await pressBetweenAnswerAndRender(transport, SESSION);
    await submitField(PASSWORD_INPUT);

    expect(sentPasswords(transport)).toEqual([PLANTED_PASSWORD]);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("leaves the next drawn step able to send an edited password", async () => {
    const { transport } = await renderStep();
    await signIn(PLANTED_PASSWORD);
    await pressBetweenAnswerAndRender(transport, new TransportError("status", 401));

    await typeInto(PASSWORD_INPUT, "second-try");
    await press("sign-in-submit");

    expect(sentPasswords(transport)).toEqual([PLANTED_PASSWORD, "second-try"]);
  });
});

describe("only a change of a field's text lifts the guard", () => {
  it.each([
    ["Password reporting the empty text it already shows", PASSWORD_INPUT, ""],
    ["Username reporting the name it already shows", USERNAME_INPUT, "Louise"],
  ])("%s lifts nothing", async (_name, testID, text) => {
    const { transport } = await renderStep();
    await signIn(PLANTED_PASSWORD);
    await answer(transport, new TransportError("status", 401));

    await fireEvent.changeText(screen.getByTestId(testID), text);
    await settle();
    await press("sign-in-submit");

    expect(sentPasswords(transport)).toEqual([PLANTED_PASSWORD]);
  });
});

describe("a password typed while an empty try is in flight", () => {
  it.each([
    ["a network failure", new TransportError("network")],
    ["a redirect", new TransportError("redirect")],
    ["a 500", new TransportError("status", 500)],
  ])("is not replaced by an empty password after %s", async (_name, failure) => {
    const { transport } = await renderStep();
    await signIn("");
    await typeInto(PASSWORD_INPUT, PLANTED_PASSWORD);

    await answer(transport, failure);
    await press("sign-in-submit");
    await submitField(PASSWORD_INPUT);

    expect(screen.getByTestId(PASSWORD_INPUT).props.value).toBe("");
    expect(sentPasswords(transport)).toEqual([""]);
  });

  it("leaves the empty try repeatable when the viewer erased it again", async () => {
    const { transport } = await renderStep();
    await signIn("");
    await typeInto(PASSWORD_INPUT, "x");
    await typeInto(PASSWORD_INPUT, "");

    await answer(transport, new TransportError("network"));
    await press("sign-in-submit");

    expect(sentPasswords(transport)).toEqual(["", ""]);
  });

  it("does not hold a later empty try that nothing was typed into", async () => {
    const { transport } = await renderStep();
    await signIn("");
    await typeInto(PASSWORD_INPUT, PLANTED_PASSWORD);
    await answer(transport, new TransportError("network"));
    await typeInto(USERNAME_INPUT, "Louisa");
    await press("sign-in-submit");

    await answer(transport, new TransportError("network"));
    await press("sign-in-submit");

    expect(sentPasswords(transport)).toEqual(["", "", ""]);
  });
});
