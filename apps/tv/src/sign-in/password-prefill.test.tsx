// T4-05 item 3 (docs/specs/T4-05.md, D8, Q6): when a confirmed revoke returns an account to sign-in, the password step
// opens with Username already holding the account's name, focus on Password, and the empty password held: nothing is
// sent until the viewer edits a field. No sentence says why the viewer is back.
//
// Testing contract (the implementer builds to it)
// - `PasswordStep` takes an optional `initialUsername`. Without it the step is as T4-04 built it.
// - Other testIDs are listed in test-support/password-doubles.tsx.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { ReducedMotionProvider } from "../design/motion";
import { PasswordStep } from "./password-step";
import { ChosenServerContext, SignInServicesContext, type ChosenServer, type SignedIn } from "./sign-in-services";
import { QuickConnectTransport, gatewaysFor } from "./test-support/quick-connect-doubles";
import { captureBack, focusClaim, forgetFocus, makeRig, press, settle, statusText } from "./test-support/sign-in-doubles";
import { submitField, typeInto } from "./test-support/password-doubles";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

const ALPHA = "https://alpha.example.test";
const NAME = "Louise";
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

async function renderPrefilled() {
  const transport = new QuickConnectTransport();
  const rig = makeRig({ gateways: gatewaysFor(transport) });
  const gateway = await rig.gateways(ALPHA, { confirmations: rig.confirmations });
  await gateway.connect();
  const chosen: ChosenServer = { gateway, serverName: "Fixture Server", address: gateway.serverUrl };
  const onSignedIn = jest.fn<(signedIn: SignedIn) => void>();
  await render(
    <ReducedMotionProvider value>
      <SignInServicesContext.Provider value={rig.services}>
        <ChosenServerContext.Provider value={chosen}>
          <PasswordStep chosen={chosen} changeServer={jest.fn()} onSignedIn={onSignedIn} initialUsername={NAME} />
        </ChosenServerContext.Provider>
      </SignInServicesContext.Provider>
    </ReducedMotionProvider>,
  );
  await settle();
  return { transport, onSignedIn };
}

const credentials = (transport: QuickConnectTransport) => transport.signIns.map((signIn) => signIn.credential);

describe("T4-05 item 3: the password step opens with the user already chosen", () => {
  it("T4-05 item 3: Username holds the account's name and focus opens on Password, with no sentence", async () => {
    await renderPrefilled();

    expect(screen.getByTestId(USERNAME_INPUT).props.value).toBe(NAME);
    expect(screen.getByTestId(PASSWORD_INPUT).props.value).toBe("");
    expect(focusClaim()).toBe("sign-in-password");
    expect(screen.queryByTestId("sign-in-failure")).toBeNull();
    expect(statusText()).toBeUndefined();
  });

  it.each([
    ["Sign in", () => press("sign-in-submit")],
    ["the Password field's action key", () => submitField(PASSWORD_INPUT)],
  ])("T4-05 item 3: %s sends nothing before a field is edited", async (_name, send) => {
    const { transport } = await renderPrefilled();
    expect(screen.getByTestId(USERNAME_INPUT).props.value).toBe(NAME);

    await send();
    await send();

    expect(transport.signIns).toEqual([]);
  });

  it("T4-05 item 3: after an edit that leaves the password empty, Sign in sends the kept name", async () => {
    const { transport } = await renderPrefilled();
    await typeInto(PASSWORD_INPUT, "x");
    await typeInto(PASSWORD_INPUT, "");

    await press("sign-in-submit");

    expect(credentials(transport)).toEqual([{ kind: "password", username: NAME, password: "" }]);
  });

  it("T4-05 item 3: a typed password signs in with the kept name", async () => {
    const { transport, onSignedIn } = await renderPrefilled();
    await typeInto(PASSWORD_INPUT, "fixture-password-1");

    await press("sign-in-submit");

    expect(credentials(transport)).toEqual([{ kind: "password", username: NAME, password: "fixture-password-1" }]);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });
});
