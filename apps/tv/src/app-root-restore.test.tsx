// T4-05 items 2 and 3 (docs/specs/T4-05.md, D6 to D8; Q4, Q6, Q7, Q12, Q13; spec check notes 1 and 6): at launch the root
// shows "Loading…" alone until the restore answers. A validated session opens Home and no sign-in control ever mounts. A
// confirmed revoke returns to sign-in on that server with the user's name kept: past the server step for HTTPS, on it with
// the unencrypted-connection dialog open (Cancel focused) for a private-LAN http:// server. A restore that cannot be
// validated shows the copy table's sentence with Try again and Change server; Change server reaches the Server URL field
// with the remote alone, and no request carrying the session is sent on the first try or the second.
//
// The testing contract is in test-support/restore-root-doubles.tsx.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { restoreSession } from "@octave/core/src/jellyfin/restore-session";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { FakeClock } from "@octave/core/src/ports/fake-clock";
import { colors } from "./design/tokens";
import { PasswordStep } from "./sign-in/password-step";
import { createQuickConnectStep } from "./sign-in/quick-connect-step";
import { resetFocusBridge } from "./shell/test-support/focus-bridge-double";
import { SERVER_NAME, fakeGateway } from "./signed-in/test-support/signed-in-doubles";
import { LAN, QuickConnectTransport, SERVER_ID, gatewaysFor, httpStatus } from "./sign-in/test-support/quick-connect-doubles";
import { DIALOG, SENTENCES, captureBack, focusClaim, forgetFocus, makeRig, openModal, press, requestClose, settle, textIn, type Rig } from "./sign-in/test-support/sign-in-doubles";
import { focusSentTo, typeInto } from "./sign-in/test-support/password-doubles";
import { deferredOutcome, makeParts, renderRoot, signInOver, type RestoreOutcome } from "./test-support/restore-root-doubles";

jest.mock("@shopify/flash-list", () => require("./design/rows/test-support/flash-list-double"));
jest.mock("./shell/focus-bridge", () => require("./shell/test-support/focus-bridge-double"));

const ALPHA = "https://alpha.example.test";
const STORED_SESSION = "0123456789abcdef0123456789abcd10";
const LOADING = "Loading…";
const NAME = "Louise";

let backKey: ReturnType<typeof captureBack>;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
  backKey = captureBack();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const stored = (server: string, over: Record<string, unknown> = {}) => ({
  session: STORED_SESSION,
  server,
  deviceId: "fixture-device-id-1",
  userId: "user-1",
  serverId: SERVER_ID,
  userName: NAME,
  ...over,
});

/** The core's restore over `transport` and the sign-in rig's confirmation store, as the host wires it (D6). */
function coreRestore(transport: QuickConnectTransport | Rig["transport"], rig: Rig, ...sessions: ReturnType<typeof stored>[]) {
  const source = { restoreSessions: jest.fn(async () => sessions) };
  const factory = gatewaysFor(transport);
  const restore = jest.fn(() => restoreSession({ restore: source, gateways: (server: string) => factory(server, { confirmations: rig.confirmations }), timeoutMs: 5_000 }) as Promise<RestoreOutcome>);
  return { restore, source };
}

const sessionRequests = (transport: { requests: ReadonlyArray<{ target: object }> }) => transport.requests.filter((request) => "session" in request.target);
const buttonIds = (): string[] => screen.queryAllByRole("button").map((button) => String(button.props.testID));

describe("T4-05 item 2: a stored, validated session opens Home with no sign-in screen", () => {
  it("T4-05 item 2: Loading… shows alone until the restore answers, then Home, and no sign-in control ever mounts", async () => {
    const rig = makeRig();
    const { SignIn, drawn } = signInOver(rig.services, () => null);
    const parts = makeParts();
    const pending = deferredOutcome();
    const gateway = fakeGateway() as unknown as JellyfinGateway;

    await renderRoot({ signIn: SignIn, signedInParts: parts, restore: () => pending.promise });

    expect(screen.getByText(LOADING)).toBeTruthy();
    expect(buttonIds()).toEqual([]);
    expect(screen.queryByTestId("sign-in-server-step")).toBeNull();

    pending.resolve({ kind: "signed-in", gateway, serverName: SERVER_NAME });
    await settle();

    expect(screen.getByTestId("screen-home")).toBeTruthy();
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(drawn).not.toHaveBeenCalled();
    expect(parts.mock.calls.at(-1)?.[0]).toStrictEqual({ gateway, serverName: SERVER_NAME });
  });

  it("T4-05 item 2: through the core, a matched probe and a 2xx from /Users/Me open Home on the stored session", async () => {
    const transport = new QuickConnectTransport();
    const rig = makeRig({ gateways: gatewaysFor(transport) });
    const { SignIn, drawn } = signInOver(rig.services, () => null);
    const parts = makeParts();
    const { restore } = coreRestore(transport, rig, stored(ALPHA));

    await renderRoot({ signIn: SignIn, signedInParts: parts, restore });
    await settle();

    expect(screen.getByTestId("screen-home")).toBeTruthy();
    expect(drawn).not.toHaveBeenCalled();
    const handed = parts.mock.calls.at(-1)?.[0];
    expect(handed?.serverName).toBe("Fixture Server");
    expect(handed?.gateway.sessionId()).toBe(STORED_SESSION);
    expect(transport.ended).toEqual([]);
  });

  it.each([
    ["nothing is stored", () => Promise.resolve({ kind: "none" } as RestoreOutcome)],
    ["the restore rejects", () => Promise.reject(new Error("fixture rejection"))],
  ])("T4-05 item 2: when %s, sign-in's first step opens", async (_name, restore) => {
    const rig = makeRig();
    const { SignIn, drawn } = signInOver(rig.services, () => null);

    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), restore });

    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(drawn.mock.calls.at(-1)?.[0]).toBeUndefined();
  });

  it("T4-05 item 2: Back on Loading… leaves the app", async () => {
    const rig = makeRig();
    const { SignIn } = signInOver(rig.services, () => null);
    const pending = deferredOutcome();
    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), restore: () => pending.promise });

    await backKey.back();

    expect(backKey.exitApp).toHaveBeenCalledTimes(1);
  });
});

describe("T4-05 item 2: a restore that cannot be validated shows the unavailable screen", () => {
  const unavailable = (failure: string): RestoreOutcome => ({ kind: "unavailable", address: ALPHA, failure });

  it.each([
    ["unreachable", SENTENCES.unreachable(ALPHA)],
    ["redirect", SENTENCES.redirect],
    ["unsupported-version", SENTENCES.unsupportedVersion],
    ["other", SENTENCES.other],
  ])("T4-05 item 2: %s shows its sentence, then Try again (focused) and Change server", async (failure, sentence) => {
    const rig = makeRig();
    const { SignIn, drawn } = signInOver(rig.services, () => null);

    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), restore: async () => unavailable(failure) });

    expect(screen.getByTestId("restore-unavailable")).toBeTruthy();
    const line = screen.getByTestId("restore-unavailable-sentence");
    expect(textIn("restore-unavailable-sentence")).toBe(sentence);
    expect(line.props.accessibilityRole ?? line.props.role).toBe("header");
    expect(StyleSheet.flatten(line.props.style as never)).toMatchObject({ color: colors.text1 });
    expect(buttonIds()).toEqual(["restore-try-again", "restore-change-server"]);
    expect(textIn("restore-try-again")).toBe("Try again");
    expect(textIn("restore-change-server")).toBe("Change server");
    expect(focusClaim()).toBe("restore-try-again");
    expect(drawn).not.toHaveBeenCalled();
  });

  it("T4-05 item 2: through the core, an unreachable server shows the couldn't-reach sentence and sends nothing with the session", async () => {
    const rig = makeRig();
    const { SignIn } = signInOver(rig.services, () => null);
    const { restore } = coreRestore(rig.transport, rig, stored(ALPHA));

    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), restore });

    expect(textIn("restore-unavailable-sentence")).toBe(SENTENCES.unreachable(ALPHA));
    expect(sessionRequests(rig.transport)).toEqual([]);
  });

  it("T4-05 item 2: Try again restores again behind Loading…, and the second try sends nothing with the session either", async () => {
    const rig = makeRig();
    const { SignIn } = signInOver(rig.services, () => null);
    const { restore } = coreRestore(rig.transport, rig, stored(LAN));
    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), restore });
    expect(restore).toHaveBeenCalledTimes(1);
    rig.transport.answer(LAN, { status: 200, body: { ServerName: "Other", Version: "10.11.11", Id: "fedcba9876543210fedcba9876543210" } });

    await press("restore-try-again");

    expect(restore).toHaveBeenCalledTimes(2);
    expect(textIn("restore-unavailable-sentence")).toBe(SENTENCES.other);
    expect(sessionRequests(rig.transport)).toEqual([]);
  });

  it("T4-05 item 2: Try again shows Loading… while the second restore runs", async () => {
    const rig = makeRig();
    const { SignIn } = signInOver(rig.services, () => null);
    const second = deferredOutcome();
    const restore = jest.fn<() => Promise<RestoreOutcome>>().mockResolvedValueOnce(unavailable("unreachable")).mockReturnValueOnce(second.promise);
    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), restore });

    await press("restore-try-again");

    expect(screen.getByText(LOADING)).toBeTruthy();
    expect(screen.queryByTestId("restore-unavailable")).toBeNull();
    expect(buttonIds()).toEqual([]);
  });

  it("T4-05 item 2: Change server reaches the Server URL field with the remote alone, and nothing is sent with the session or ended", async () => {
    const rig = makeRig();
    const ended = jest.spyOn(rig.transport, "endSession");
    const { SignIn, drawn } = signInOver(rig.services, () => null);
    const { restore } = coreRestore(rig.transport, rig, stored(ALPHA));
    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), restore });

    await press("restore-change-server");

    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(screen.getByTestId("sign-in-address-input")).toBeTruthy();
    expect(drawn.mock.calls.at(-1)?.[0]).toBeUndefined();
    expect(sessionRequests(rig.transport)).toEqual([]);
    expect(ended).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("T4-05 item 2: Back on the unavailable screen leaves the app", async () => {
    const rig = makeRig();
    const { SignIn } = signInOver(rig.services, () => null);
    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), restore: async () => unavailable("unreachable") });

    await backKey.back();

    expect(backKey.exitApp).toHaveBeenCalledTimes(1);
  });
});

describe("T4-05 item 3: a confirmed revoke returns the account to sign-in with its server and user chosen", () => {
  async function revokedAt(server: string) {
    const transport = new QuickConnectTransport();
    transport.script("GET /Users/Me", httpStatus(401));
    const rig = makeRig({ gateways: gatewaysFor(transport) });
    const QuickConnect = createQuickConnectStep({ clock: new FakeClock(1_000_000) });
    const { SignIn, drawn } = signInOver(rig.services, QuickConnect, PasswordStep);
    const { restore } = coreRestore(transport, rig, stored(server));
    forgetFocus();
    await renderRoot({ signIn: SignIn, signedInParts: makeParts(), restore });
    return { transport, rig, drawn };
  }

  it("T4-05 item 3: over HTTPS the flow opens past the server step on that server, and the session was ended", async () => {
    const { transport, drawn } = await revokedAt(ALPHA);

    expect(transport.ended).toEqual([STORED_SESSION]);
    expect(screen.queryByTestId("sign-in-server-step")).toBeNull();
    expect(screen.getByTestId("sign-in-quick-connect")).toBeTruthy();
    expect(textIn("sign-in-origin-chip")).toBe(ALPHA);
    expect(drawn.mock.calls.at(-1)?.[0]).toMatchObject({ username: NAME });
  });

  it("T4-05 item 3: on the password step Username holds the name, focus is on Password, and an empty password waits for an edit", async () => {
    const { transport } = await revokedAt(ALPHA);
    await press("sign-in-use-password");

    expect(screen.getByTestId("sign-in-username-input").props.value).toBe(NAME);
    expect(focusSentTo()).toBe("sign-in-password");
    await press("sign-in-submit");
    expect(transport.signIns).toEqual([]);

    await typeInto("sign-in-password-input", "x");
    await typeInto("sign-in-password-input", "");
    await press("sign-in-submit");
    expect(transport.signIns.map((signIn) => signIn.credential)).toEqual([{ kind: "password", username: NAME, password: "" }]);
  });

  it.each(["Back", "Change server"])("T4-05 item 3: %s from that step goes to the server step", async (how) => {
    await revokedAt(ALPHA);

    if (how === "Back") await backKey.back();
    else await press("sign-in-change-server");

    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-quick-connect")).toBeNull();
  });

  it("T4-05 item 3: on a private-LAN http:// server the server step opens with the dialog for that server, Cancel focused", async () => {
    const { rig } = await revokedAt(LAN);

    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    const dialog = within(openModal());
    expect(dialog.getByText(DIALOG.title)).toBeTruthy();
    expect(dialog.getByText(LAN)).toBeTruthy();
    expect(screen.getByTestId("sign-in-unencrypted-cancel").props.hasTVPreferredFocus).toBe(true);
    expect(screen.getByTestId("sign-in-unencrypted-connect").props.hasTVPreferredFocus).toBeFalsy();
    expect(rig.confirm).not.toHaveBeenCalled();
  });

  it("T4-05 item 3: Connect without encryption reaches the next step for that server with the name kept", async () => {
    const { rig, transport } = await revokedAt(LAN);

    await press("sign-in-unencrypted-connect");

    expect(rig.confirm).toHaveBeenCalledWith({ serverId: SERVER_ID, origin: LAN });
    expect(screen.getByTestId("sign-in-quick-connect")).toBeTruthy();
    expect(textIn("sign-in-origin-chip")).toBe(LAN);
    await press("sign-in-use-password");
    expect(screen.getByTestId("sign-in-username-input").props.value).toBe(NAME);
    await typeInto("sign-in-password-input", "fixture-password-1");
    await press("sign-in-submit");
    expect(transport.signIns.map((signIn) => signIn.credential)).toEqual([{ kind: "password", username: NAME, password: "fixture-password-1" }]);
  });

  it.each(["Cancel", "Back"])("T4-05 item 3: %s closes the dialog and leaves the server step with its usual opening focus", async (how) => {
    const { rig } = await revokedAt(LAN);
    forgetFocus();

    if (how === "Cancel") await press("sign-in-unencrypted-cancel");
    else await requestClose();
    await settle();

    expect(screen.queryByTestId("sign-in-unencrypted-cancel")).toBeNull();
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-quick-connect")).toBeNull();
    expect(rig.confirm).not.toHaveBeenCalled();
    expect(focusClaim()).toBe("sign-in-search-again");
  });
});
