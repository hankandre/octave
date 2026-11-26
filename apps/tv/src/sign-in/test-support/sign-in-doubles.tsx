// Doubles for the T4-02 sign-in tests (frozen with T4-02): a fake discovery, a probe transport that answers per server,
// the real gateway factory over it (host/gateway.ts), a fake later step, the Back button and the render of `SignInApp`.
//
// Testing contract (the implementer builds to it)
// - `SignInApp` (../sign-in-app) takes `{ services, nextStep }`; `services` is `SignInServices` (../sign-in-services):
//   `{ discovery, gateways, confirmations, remembered, leave? }`. `nextStep` gets `{ chosen, changeServer }`, and
//   `chosen` is `{ gateway, serverName, address }` (D8).
// - `SignInStepFrame` (../sign-in-step-frame) takes `{ heading, children }`.
// - testIDs: sign-in-server-step (step 1's root); server-row-<n> (the focusable row, n counting every row in listed
//   order from 0, remembered rows first); sign-in-enter-address, sign-in-search-again (the buttons);
//   sign-in-address (the TextField's testID, so sign-in-address-input is its input); sign-in-status (the status line,
//   drawn only when it has text); sign-in-unencrypted (the Dialog's testID, with action ids "connect" and "cancel", so
//   sign-in-unencrypted-connect, sign-in-unencrypted-cancel and sign-in-unencrypted-fade); sign-in-origin-chip.
// - Focus is claimed the app's two ways: `hasTVPreferredFocus` on exactly one control, or `focusView` of
//   shell/focus-bridge. Each file mocks the bridge with its frozen double. `focusClaim` reads whichever was used.
import { jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { BackHandler, Text, View } from "react-native";
import type { TestInstance } from "test-renderer";
import type { DiscoveredServer, ServerDiscovery } from "@octave/core/src/domain/server-discovery";
import { MemoryLanHttpConfirmations } from "@octave/core/src/lan-http-confirmations";
import type { Crypto } from "@octave/core/src/ports/crypto";
import type { SignInRequest, SignInResult, Transport, TransportRequest, TransportResponse } from "@octave/core/src/ports/transport";
import { TransportError } from "@octave/core/src/ports/transport";
import { MemoryRememberedServers } from "@octave/core/src/remembered-servers";
import { Button } from "../../design/controls/button";
import { ReducedMotionProvider } from "../../design/motion";
import { createGatewayFactory, type GatewayFactory } from "../../host/gateway";
import { focusView, resetFocusBridge, testIDOf } from "../../shell/test-support/focus-bridge-double";
import { SignInApp } from "../sign-in-app";
import type { SignInServices } from "../sign-in-services";
import { SignInStepFrame } from "../sign-in-step-frame";

export const ID_ONE = "0123456789abcdef0123456789abcdef";
export const ID_TWO = "fedcba9876543210fedcba9876543210";

export const SENTENCES = {
  unreachable: (address: string) => `Couldn't reach ${address}. Check the address and that the server is running.`,
  refusedPlainHttp:
    "This address uses plain HTTP on the internet, so Octave will not connect. Use HTTPS, or HTTP only for this device or a private home-network address such as 192.168.x.x, a name.local name, or a name.home.arpa name.",
  unicodeHost: "This address uses characters Octave can't check. Type the server's plain address instead.",
  redirect: "The server answered with a redirect, which Octave does not follow. Enter the server's final address instead.",
  unsupportedVersion: "This server's version isn't supported. Octave needs Jellyfin 10.11 or newer.",
  notAnAddress: "That isn't a server address. Type it like 192.168.1.5:8096 or media.example.com.",
  notTheDiscoveredServer: "The server at this address is not the one that answered on your network. Octave did not connect. Enter the server's address yourself.",
  other: "Something went wrong. Try again.",
} as const;

export const DIALOG = {
  title: "This server uses an unencrypted connection",
  body: "Your password and sign-in token will travel across your network without encryption. Anyone else on this network could read them and use your account. Continue only on a network you trust, such as your home network.",
  connect: "Connect without encryption",
  cancel: "Cancel",
} as const;

export const CONFLICT_LINE = "Another address on this network answered as this server.";

export function found(id: string, address: string, name: string, over: Partial<DiscoveredServer> = {}): DiscoveredServer {
  return { id, address, name, advertisedBy: "192.168.1.5", addressIsSender: true, conflicting: false, ...over };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export const publicInfo = (id: string | undefined, name: string, version = "10.11.11") => ({
  status: 200,
  body: { ServerName: name, Version: version, ...(id === undefined ? {} : { Id: id }) },
});

type Answer = TransportResponse | Error | Promise<TransportResponse>;

/** Answers the probe by the server it names. A server with no answer is unreachable. It records every call. */
export class ProbeTransport implements Transport {
  readonly requests: TransportRequest[] = [];
  readonly signIns: SignInRequest[] = [];
  private readonly answers = new Map<string, Answer>();

  answer(server: string, answer: Answer): void {
    this.answers.set(server, answer);
  }

  async signIn(request: SignInRequest): Promise<SignInResult> {
    this.signIns.push(request);
    throw new TransportError("refused");
  }

  async request(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    const server = "server" in request.target ? request.target.server : "";
    const answer = this.answers.get(server) ?? new TransportError("network");
    if (answer instanceof Error) throw answer;
    return answer;
  }

  async endSession(): Promise<void> {}
}

const crypto: Crypto = {
  sha256Hex: async () => "0".repeat(64),
  randomId: () => "11111111-1111-4111-8111-111111111111",
};

export function fakeDiscovery(...answers: DiscoveredServer[][]) {
  let call = 0;
  const discover = jest.fn(async () => {
    const servers = answers[Math.min(call, answers.length - 1)] ?? [];
    call += 1;
    return { servers, refused: 0, dropped: 0 };
  });
  return { discover } satisfies ServerDiscovery;
}

export function makeRig(options: { servers?: DiscoveredServer[]; discovery?: ServerDiscovery; gateways?: GatewayFactory; leave?: () => void } = {}) {
  const transport = new ProbeTransport();
  const real = createGatewayFactory({ crypto, transport, installId: async () => "22222222-2222-4222-8222-222222222222" });
  const gateways = jest.fn<GatewayFactory>(options.gateways ?? real);
  const confirmations = new MemoryLanHttpConfirmations();
  const confirm = jest.spyOn(confirmations, "remember");
  const remembered = new MemoryRememberedServers();
  const discovery = options.discovery ?? fakeDiscovery(options.servers ?? []);
  const leave = options.leave;
  const services: SignInServices = { discovery, gateways, confirmations, remembered, ...(leave ? { leave } : {}) };
  /** Each server the later step was handed, in order. */
  const handed: Array<{ serverName: string; address: string; serverUrl: string }> = [];
  return { transport, real, gateways, confirmations, confirm, remembered, discovery, services, handed };
}

export type Rig = ReturnType<typeof makeRig>;

type StepProps = { chosen: { serverName: string; address: string; gateway: { serverUrl: string } }; changeServer(): void };

function nextStepFor(rig: Rig) {
  return function NextStep({ chosen, changeServer }: StepProps) {
    const last = rig.handed.at(-1);
    if (last?.address !== chosen.address) rig.handed.push({ serverName: chosen.serverName, address: chosen.address, serverUrl: chosen.gateway.serverUrl });
    return (
      <SignInStepFrame heading="Fake later step">
        <View testID="fake-later-step">
          <Text>{chosen.serverName}</Text>
          <Button testID="fake-change-server" label="Change server" variant="quiet" onPress={changeServer} />
        </View>
      </SignInStepFrame>
    );
  };
}

export function app(rig: Rig) {
  const NextStep = nextStepFor(rig);
  return (
    <ReducedMotionProvider value>
      <SignInApp services={rig.services} nextStep={NextStep} />
    </ReducedMotionProvider>
  );
}

/** Lets settled promises, effects and timers reach the screen. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 25; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  for (let round = 0; round < 10; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export async function renderApp(rig: Rig) {
  const view = await render(app(rig));
  await settle();
  return view;
}

export async function press(testID: string): Promise<void> {
  await fireEvent.press(screen.getByTestId(testID));
  await settle();
}

export async function typeAddress(text: string): Promise<void> {
  await fireEvent.changeText(screen.getByTestId("sign-in-address-input"), text);
  await fireEvent(screen.getByTestId("sign-in-address-input"), "submitEditing", { nativeEvent: { text } });
  await settle();
}

export function allText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const child of node) allText(child, out);
  else if (node !== null && typeof node === "object") allText((node as { children?: unknown }).children ?? [], out);
  return out;
}

export const screenText = (): string => allText(screen.toJSON()).join("\n");

/** All the text drawn inside one element, joined with nothing between the pieces. */
export function textIn(testID: string): string {
  const read = (node: TestInstance | string): string => (typeof node === "string" ? node : node.children.map(read).join(""));
  return read(screen.getByTestId(testID));
}

export const statusText = (): string | undefined => (screen.queryByTestId("sign-in-status") === null ? undefined : textIn("sign-in-status"));

export const rowIds = (): string[] => screen.queryAllByTestId(/^server-row-\d+$/).map((element) => String(element.props.testID));

export const preferredFocus = (): unknown[] => screen.container.queryAll((instance) => Boolean(instance.props.hasTVPreferredFocus)).map((instance) => instance.props.testID);

/** Where focus was last sent: the bridge's last `focusView`, else the one control with preferred focus. */
export function focusClaim(): unknown {
  const last = focusView.mock.calls.at(-1);
  if (last !== undefined) return testIDOf(last[0]);
  const claims = preferredFocus();
  return claims.length === 1 ? claims[0] : claims;
}

/** Where focus was sent, other than `testID`: empty when nothing asked focus to leave it. */
export function sentElsewhere(testID: string): unknown[] {
  const asked = [...focusView.mock.calls.map((call) => testIDOf(call[0])), ...preferredFocus()];
  return asked.filter((target) => target !== testID);
}

/** Forget earlier `focusView` calls, so the next `focusClaim` reads only what follows. */
export function forgetFocus(): void {
  resetFocusBridge();
}

/** The open Modal: what the unencrypted-connection dialog draws, apart from the step behind it. */
export function openModal(): TestInstance {
  const modal = screen.container.queryAll((instance) => typeof instance.props.onRequestClose === "function")[0];
  if (modal === undefined) throw new Error("no Modal is open");
  return modal;
}

export function requestClose(): Promise<void> {
  const modal = openModal();
  return act(async () => {
    modal.props.onRequestClose();
  });
}

type Listener = () => boolean | null | undefined;

/** Records the app's Back listeners and `exitApp`. `back` calls the last registered listener, as Android does first. */
export function captureBack() {
  let listeners: Listener[] = [];
  const results: Array<boolean | null | undefined> = [];
  const seen = { calls: 0 };
  jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_name: string, handler: Listener) => {
    const counted: Listener = () => {
      seen.calls += 1;
      return handler();
    };
    listeners.push(counted);
    return {
      remove: () => {
        listeners = listeners.filter((listener) => listener !== counted);
      },
    };
  }) as never);
  const exitApp = jest.spyOn(BackHandler, "exitApp").mockImplementation(() => undefined);
  const back = async (): Promise<boolean | null | undefined> => {
    const listener = listeners.at(-1);
    if (listener === undefined) throw new Error("no Back listener was registered");
    await act(async () => {
      results.push(listener());
    });
    await settle();
    return results.at(-1);
  };
  return { back, exitApp, seen };
}
