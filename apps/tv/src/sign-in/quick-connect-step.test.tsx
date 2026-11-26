// T4-03 items 1, 2, 4, 5 and 6 (docs/specs/T4-03.md, D2, D6, D9): the Quick Connect step over the real gateway, with a
// scripted transport, a fake clock and the QR encoder spied. The testing contract is in test-support/quick-connect-doubles.tsx.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking, StyleSheet } from "react-native";
import { FakeClock } from "@octave/core/src/ports/fake-clock";
import { encode } from "uqr";
import { ReducedMotionProvider } from "../design/motion";
import { colors } from "../design/tokens";
import { createQuickConnectStep } from "./quick-connect-step";
import { ChosenServerContext, type SignedIn } from "./sign-in-services";
import { captureBack, deferred, focusClaim, forgetFocus, screenText, settle, statusText, textIn } from "./test-support/sign-in-doubles";
import {
  CODE,
  CONNECT,
  COPY,
  INITIATE,
  INTERVAL,
  LAN,
  LOOPBACK,
  NEW_CODE,
  PLANTED_PASSWORD,
  PLANTED_TOKEN,
  SECRET,
  QuickConnectTransport,
  approved,
  chooseServer,
  drawnModules,
  everyProp,
  httpStatus,
  moduleWidth,
  pending,
  qrStyle,
  wait,
} from "./test-support/quick-connect-doubles";
import type { TransportResponse } from "@octave/core/src/ports/transport";
import { TransportError } from "@octave/core/src/ports/transport";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

jest.mock("uqr", () => {
  const actual = jest.requireActual("uqr") as typeof import("uqr");
  return { ...actual, encode: jest.fn(actual.encode) };
});

// Every state the core's run reports to the step.
const mockStates: unknown[] = [];
jest.mock("@octave/core/src/jellyfin/quick-connect-sign-in", () => {
  const actual = jest.requireActual("@octave/core/src/jellyfin/quick-connect-sign-in") as typeof import("@octave/core/src/jellyfin/quick-connect-sign-in");
  return {
    ...actual,
    startQuickConnect: (...[gateway, clock, listener]: Parameters<typeof actual.startQuickConnect>) =>
      actual.startQuickConnect(gateway, clock, (state) => {
        mockStates.push(state);
        listener(state);
      }),
  };
});

async function renderStep(options: { server?: string; arrange?: (transport: QuickConnectTransport) => void } = {}) {
  const transport = new QuickConnectTransport();
  options.arrange?.(transport);
  const chosen = await chooseServer(options.server ?? LAN, transport);
  const clock = new FakeClock(1_000_000);
  const Step = createQuickConnectStep({ clock });
  const changeServer = jest.fn();
  const onSignedIn = jest.fn<(signedIn: SignedIn) => void>();
  const openPassword = jest.fn();
  const view = await render(
    <ReducedMotionProvider value>
      <ChosenServerContext.Provider value={chosen}>
        <Step chosen={chosen} changeServer={changeServer} onSignedIn={onSignedIn} openPassword={openPassword} />
      </ChosenServerContext.Provider>
    </ReducedMotionProvider>,
  );
  await settle();
  return { view, transport, chosen, clock, changeServer, onSignedIn, openPassword };
}

const spiedEncode = jest.mocked(encode);
const LAN_LINK = `${LAN}/web/#/quickconnect?code=${CODE}`;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  forgetFocus();
  captureBack();
  mockStates.length = 0;
  spiedEncode.mockClear();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const codeIsDrawn = (text: string) => expect(textIn("sign-in-code")).toBe(text);

describe("T4-03 item 1: the code and the QR code together, and no key needed", () => {
  it("T4-03 item 1: shows the code and QR code, and signs in by itself when the phone approves", async () => {
    const rig = await renderStep({ arrange: (transport) => transport.script(CONNECT, pending(), pending(), approved()) });

    codeIsDrawn("482 913");
    expect(screen.getByTestId("sign-in-qr")).toBeTruthy();
    expect(screen.getByRole("header", { name: COPY.heading })).toBeTruthy();
    expect(screen.getByText(COPY.scan)).toBeTruthy();
    expect(textIn("sign-in-origin-chip")).toBe(LAN);
    expect(rig.onSignedIn).not.toHaveBeenCalled();

    await wait(rig.clock, 3 * INTERVAL);

    expect(rig.onSignedIn).toHaveBeenCalledTimes(1);
    expect(rig.onSignedIn.mock.calls[0]?.[0]).toStrictEqual({ gateway: rig.chosen.gateway, serverName: "Fixture Server" });
    expect(rig.openPassword).not.toHaveBeenCalled();
  });

  it("T4-03 item 1: the code is read to TalkBack digit by digit, and the QR code is hidden from it", async () => {
    await renderStep();

    expect(screen.getByTestId("sign-in-code").props.accessibilityLabel).toBe("4 8 2 9 1 3");
    expect(screen.getByTestId("sign-in-qr").props.accessible).toBe(false);
  });

  it("T4-03 item 1: while the code loads, the step says so and Change server holds focus", async () => {
    const slow = deferred<TransportResponse>();
    await renderStep({ arrange: (transport) => transport.script(INITIATE, slow.promise) });

    expect(statusText()).toBe(COPY.loading);
    expect(screen.getByTestId("sign-in-status").props.accessibilityLiveRegion).toBe("polite");
    expect(screen.queryByTestId("sign-in-code")).toBeNull();
    expect(screen.queryByTestId("sign-in-qr")).toBeNull();
    expect(focusClaim()).toBe("sign-in-change-server");
  });

  it("T4-03 item 1: while it signs in, the code stays and the step says it is loading", async () => {
    const slow = deferred<{ session: string; userId: string }>();
    const rig = await renderStep({
      arrange: (transport) => {
        transport.script(CONNECT, approved());
        transport.signInAnswer = slow.promise;
      },
    });

    await wait(rig.clock, INTERVAL);

    codeIsDrawn("482 913");
    expect(statusText()).toBe(COPY.loading);
    expect(rig.onSignedIn).not.toHaveBeenCalled();
  });

  it("T4-03 item 1: Change server is always drawn and calls the flow", async () => {
    const rig = await renderStep();

    await fireEvent.press(screen.getByTestId("sign-in-change-server"));
    await settle();

    expect(rig.changeServer).toHaveBeenCalledTimes(1);
  });
});

describe("T4-03 item 2: the QR code holds the approval link and nothing secret", () => {
  it("T4-03 item 2: only the approval link reaches the encoder, with error correction M and no border of its own", async () => {
    await renderStep();

    expect(spiedEncode).toHaveBeenCalled();
    for (const [text, options] of spiedEncode.mock.calls) {
      expect(text).toBe(LAN_LINK);
      expect(options).toEqual({ ecc: "M", border: 0 });
    }
  });

  it("T4-03 item 2: the drawn modules are the encoder's, dark on light, with a four-module quiet zone", async () => {
    await renderStep();
    const actual = jest.requireActual("uqr") as typeof import("uqr");
    const expected = actual.encode(LAN_LINK, { ecc: "M", border: 0 });

    expect(drawnModules(expected.size)).toEqual(expected.data);
    expect(qrStyle().padding).toBe(4 * moduleWidth(expected.size));
    expect(StyleSheet.flatten(screen.getByTestId("sign-in-qr").props.style as never)).toMatchObject({ backgroundColor: colors.text1 });
  });

  it("T4-03 item 2: no state the run reports and nothing drawn holds the secret, a token or a password, in any phase", async () => {
    const rig = await renderStep({ arrange: (transport) => transport.script(CONNECT, pending(), httpStatus(404), approved()) });
    const rendered = [everyProp()];

    await wait(rig.clock, INTERVAL);
    rendered.push(everyProp());
    await wait(rig.clock, INTERVAL);
    rendered.push(everyProp());

    const everything = [...rendered, JSON.stringify(mockStates), screenText()].join("\n");
    expect(mockStates.length).toBeGreaterThan(0);
    for (const secret of [SECRET, PLANTED_TOKEN, PLANTED_PASSWORD]) expect(everything).not.toContain(secret);
  });
});

type Failure = { name: string; arrange: (transport: QuickConnectTransport) => void; sentence: string };

const EXPIRED_OR_REFUSED: Failure[] = [
  { name: "a poll answered 404", arrange: (transport) => transport.script(CONNECT, httpStatus(404), pending()), sentence: COPY.expired },
  { name: "a poll answered 401", arrange: (transport) => transport.script(CONNECT, httpStatus(401), pending()), sentence: COPY.refused },
  { name: "a poll answered 403", arrange: (transport) => transport.script(CONNECT, httpStatus(403), pending()), sentence: COPY.refused },
  {
    name: "a sign-in answered 404",
    arrange: (transport) => {
      transport.script(CONNECT, approved(), pending());
      transport.signInAnswer = new TransportError("status", 404);
    },
    sentence: COPY.expired,
  },
  {
    name: "a sign-in answered 401",
    arrange: (transport) => {
      transport.script(CONNECT, approved(), pending());
      transport.signInAnswer = new TransportError("status", 401);
    },
    sentence: COPY.refused,
  },
];

describe("T4-03 item 4: an expired or refused code, and a new code after one press", () => {
  it.each(EXPIRED_OR_REFUSED)("T4-03 item 4: $name shows its sentence with Get a new code focused, and one press shows the new code", async ({ arrange, sentence }) => {
    const rig = await renderStep({ arrange });
    forgetFocus();

    await wait(rig.clock, INTERVAL);

    expect(screen.getByText(sentence).props.accessibilityLiveRegion).toBe("polite");
    expect(screen.getByRole("button", { name: "Get a new code" })).toBeTruthy();
    expect(screen.queryByTestId("sign-in-code")).toBeNull();
    expect(screen.queryByTestId("sign-in-qr")).toBeNull();
    expect(screen.getByTestId("sign-in-change-server")).toBeTruthy();
    expect(focusClaim()).toBe("sign-in-new-code");

    forgetFocus();
    await fireEvent.press(screen.getByTestId("sign-in-new-code"));
    await settle();

    codeIsDrawn("731 205");
    expect(screen.queryByText(sentence)).toBeNull();
    expect(screen.queryByTestId("sign-in-new-code")).toBeNull();
    expect(rig.transport.count(INITIATE)).toBe(2);
    expect(NEW_CODE).toBe("731205");
  });

  it("T4-03 item 4: while the new code loads, focus goes to Change server", async () => {
    const slow = deferred<TransportResponse>();
    const first = { status: 200, body: { Secret: SECRET, Code: CODE } };
    const rig = await renderStep({
      arrange: (transport) => {
        transport.script(INITIATE, first, slow.promise);
        transport.script(CONNECT, httpStatus(404));
      },
    });
    await wait(rig.clock, INTERVAL);
    forgetFocus();

    await fireEvent.press(screen.getByTestId("sign-in-new-code"));
    await settle();

    expect(statusText()).toBe(COPY.loading);
    expect(focusClaim()).toBe("sign-in-change-server");
  });

  it("T4-03 item 4: an unreachable server shows its address and Try again, which starts over", async () => {
    const rig = await renderStep({ arrange: (transport) => transport.script(INITIATE, new TransportError("network"), { status: 200, body: { Secret: SECRET, Code: CODE } }) });

    expect(screen.getByText(COPY.unreachable(LAN)).props.accessibilityLiveRegion).toBe("polite");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(focusClaim()).toBe("sign-in-try-again");

    await fireEvent.press(screen.getByTestId("sign-in-try-again"));
    await settle();

    codeIsDrawn("482 913");
    expect(rig.transport.count("GET /QuickConnect/Enabled")).toBe(2);
  });

  it("T4-03 item 4: any other failure says something went wrong, with Try again", async () => {
    await renderStep({ arrange: (transport) => transport.script(INITIATE, httpStatus(500)) });

    expect(screen.getByText(COPY.other)).toBeTruthy();
    expect(focusClaim()).toBe("sign-in-try-again");
  });

  it("T4-03 item 4: a redirect offers only Change server", async () => {
    await renderStep({ arrange: (transport) => transport.script(INITIATE, new TransportError("redirect")) });

    expect(screen.getByText(COPY.redirect)).toBeTruthy();
    expect(screen.getAllByRole("button").map((button) => button.props.testID)).toEqual(["sign-in-change-server"]);
    expect(focusClaim()).toBe("sign-in-change-server");
  });
});

describe("T4-03 item 5: the TV never opens a browser", () => {
  async function pressEverything(): Promise<void> {
    const ids = screen.getAllByRole("button").map((button) => String(button.props.testID));
    for (const id of ids) {
      if (screen.queryByTestId(id) === null) continue;
      await fireEvent.press(screen.getByTestId(id));
      await settle();
    }
  }

  it("T4-03 item 5: no state of the step, with every control pressed, opens or asks about a link", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
    const canOpenURL = jest.spyOn(Linking, "canOpenURL").mockResolvedValue(true as never);
    const sendIntent = jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined as never);

    const waiting = await renderStep();
    await pressEverything();
    await waiting.view.unmount();

    for (const arrange of [EXPIRED_OR_REFUSED[0]?.arrange, EXPIRED_OR_REFUSED[1]?.arrange]) {
      const failed = await renderStep({ arrange });
      await wait(failed.clock, INTERVAL);
      expect(screen.getByTestId("sign-in-new-code")).toBeTruthy();
      await pressEverything();
      await failed.view.unmount();
    }

    const unreachable = await renderStep({ arrange: (transport) => transport.script(INITIATE, new TransportError("network")) });
    expect(screen.getByTestId("sign-in-try-again")).toBeTruthy();
    await pressEverything();
    await unreachable.view.unmount();

    const noLink = await renderStep({ server: LOOPBACK });
    expect(screen.getByText(COPY.noLink(LOOPBACK))).toBeTruthy();
    await pressEverything();
    await noLink.view.unmount();

    expect(openURL).not.toHaveBeenCalled();
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(sendIntent).not.toHaveBeenCalled();
  });
});

describe("T4-03 item 6: with no approval link, the code shows alone with the address to open", () => {
  it("T4-03 item 6: a loopback server shows the code, the sentence with its address, and no QR code", async () => {
    await renderStep({ server: LOOPBACK });

    codeIsDrawn("482 913");
    expect(screen.getByText(COPY.noLink(LOOPBACK))).toBeTruthy();
    expect(screen.queryByTestId("sign-in-qr")).toBeNull();
    expect(screen.queryByText(COPY.scan)).toBeNull();
    expect(spiedEncode).not.toHaveBeenCalled();
  });

  it("T4-03 item 6: a server a phone can open gets the QR code and not the address sentence", async () => {
    await renderStep({ server: LAN });

    expect(screen.getByTestId("sign-in-qr")).toBeTruthy();
    expect(screen.queryByText(COPY.noLink(LAN))).toBeNull();
  });
});
