// T4-02 items 1, 2, 3, 4, 6, 8, 9, 10 and 12 on the screen (docs/specs/T4-02.md, D3 to D9), over the real gateway with a
// probe transport. Jest has no focus engine, so focus is read from what the screen asks for (`focusClaim`). The tests go
// through `SignInApp`, the signed-out composition.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, within } from "@testing-library/react-native";
import { TransportError, type TransportResponse } from "@octave/core/src/ports/transport";
import { noServerDiscovery } from "../host/discovery";
import {
  CONFLICT_LINE,
  DIALOG,
  ID_ONE,
  ID_TWO,
  SENTENCES,
  captureBack,
  deferred,
  fakeDiscovery,
  focusClaim,
  forgetFocus,
  found,
  makeRig,
  openModal,
  preferredFocus,
  press,
  publicInfo,
  renderApp,
  requestClose,
  rowIds,
  screenText,
  settle,
  statusText,
  typeAddress,
  type Rig,
} from "./test-support/sign-in-doubles";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

const ALPHA = "https://alpha.example.test";
const BETA = "https://beta.example.test";
const LAN = "http://192.168.1.5:8096";
const MEDIA = "https://media.example.test";

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  forgetFocus();
  captureBack();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const two = () => [found(ID_ONE, ALPHA, "Alpha"), found(ID_TWO, BETA, "Beta")];

function answerBoth(rig: Rig): void {
  rig.transport.answer(ALPHA, publicInfo(ID_ONE, "Alpha"));
  rig.transport.answer(BETA, publicInfo(ID_TWO, "Beta"));
}

const handedAddresses = (rig: Rig) => rig.handed.map((server) => server.address);

describe("T4-02 item 1: the first found server has focus, and one press chooses it", () => {
  it("T4-02 item 1: with two found servers and none remembered, the first found row has preferred focus", async () => {
    const rig = makeRig({ servers: two() });
    await renderApp(rig);
    expect(screen.getByRole("header", { name: "Where is your server?" })).toBeTruthy();
    expect(rowIds()).toEqual(["server-row-0", "server-row-1"]);
    expect(within(screen.getByTestId("server-row-0")).getByText("Alpha")).toBeTruthy();
    expect(preferredFocus()).toEqual(["server-row-0"]);
  });

  it("T4-02 item 1: one press builds one gateway for its address and hands the chosen server on", async () => {
    const rig = makeRig({ servers: two() });
    answerBoth(rig);
    await renderApp(rig);
    await press("server-row-0");
    expect(rig.gateways).toHaveBeenCalledTimes(1);
    expect(rig.gateways.mock.calls[0]?.[0]).toBe(ALPHA);
    expect(rig.gateways.mock.calls[0]?.[1]?.confirmations).toBe(rig.confirmations);
    expect(rig.transport.requests).toHaveLength(1);
    expect(rig.handed).toEqual([{ serverName: "Alpha", address: ALPHA, serverUrl: ALPHA }]);
    expect(screen.getByTestId("fake-later-step")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-server-step")).toBeNull();
  });

  it("T4-02 item 1: while the probe runs the status says Loading, and a second select is ignored", async () => {
    const rig = makeRig({ servers: two() });
    const pending = deferred<TransportResponse>();
    rig.transport.answer(ALPHA, pending.promise);
    await renderApp(rig);
    await press("server-row-0");
    await press("server-row-0");
    await press("server-row-1");
    expect(statusText()).toBe("Loading…");
    expect(rig.gateways).toHaveBeenCalledTimes(1);
    expect(rig.transport.requests).toHaveLength(1);
    pending.resolve(publicInfo(ID_ONE, "Alpha"));
    await settle();
    expect(handedAddresses(rig)).toEqual([ALPHA]);
  });
});

describe("T4-02 item 2: with nothing found", () => {
  it("T4-02 item 2: Search again has preferred focus, the address field shows and Enter address is not drawn", async () => {
    const rig = makeRig({ servers: [] });
    await renderApp(rig);
    expect(rowIds()).toEqual([]);
    expect(preferredFocus()).toEqual(["sign-in-search-again"]);
    expect(screen.getByTestId("sign-in-address")).toBeTruthy();
    expect(screen.getByText("Server URL")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-enter-address")).toBeNull();
  });

  it("T4-02 item 2: Search again searches again and, with nothing found, focus is on it again", async () => {
    const rig = makeRig({ servers: [] });
    await renderApp(rig);
    forgetFocus();
    await press("sign-in-search-again");
    expect(rig.discovery.discover).toHaveBeenCalledTimes(2);
    expect(focusClaim()).toBe("sign-in-search-again");
  });

  it("T4-02 item 2: when Search again finds a server, focus is on its row", async () => {
    const discovery = fakeDiscovery([], [found(ID_ONE, ALPHA, "Alpha")]);
    const rig = makeRig({ discovery });
    await renderApp(rig);
    forgetFocus();
    await press("sign-in-search-again");
    expect(rowIds()).toEqual(["server-row-0"]);
    expect(focusClaim()).toBe("server-row-0");
  });

  it("T4-02 item 2: with a found server the field is hidden until Enter address is pressed, which shows it and moves focus to it", async () => {
    const rig = makeRig({ servers: [found(ID_ONE, ALPHA, "Alpha")] });
    await renderApp(rig);
    expect(screen.queryByTestId("sign-in-address")).toBeNull();
    forgetFocus();
    await press("sign-in-enter-address");
    expect(screen.getByTestId("sign-in-address")).toBeTruthy();
    expect(focusClaim()).toBe("sign-in-address");
  });

  it("T4-02 item 2: a discovery that fails counts as none found, with no sentence", async () => {
    const discovery = {
      discover: jest.fn(async () => {
        throw new Error("CANARY-discovery");
      }),
    };
    const rig = makeRig({ discovery });
    await renderApp(rig);
    expect(rowIds()).toEqual([]);
    expect(screen.getByTestId("sign-in-address")).toBeTruthy();
    expect(preferredFocus()).toEqual(["sign-in-search-again"]);
    expect(statusText()).toBeUndefined();
    expect(screenText()).not.toContain("CANARY");
  });
});

describe("T4-02 item 3: choosing or typing a server probes it without credentials", () => {
  it("T4-02 item 3: a typed address is probed with one tokenless request and no sign-in", async () => {
    const rig = makeRig();
    rig.transport.answer(MEDIA, publicInfo(ID_ONE, "Media"));
    await renderApp(rig);
    await typeAddress(MEDIA);
    expect(rig.transport.requests.map((request) => `${request.method} ${request.path}`)).toEqual(["GET /System/Info/Public"]);
    expect(rig.transport.requests[0]?.target).toEqual({ server: MEDIA, deviceId: "octave-unauthenticated" });
    expect(rig.transport.signIns).toEqual([]);
    expect(handedAddresses(rig)).toEqual([MEDIA]);
  });

  it("T4-02 item 3: a found server that reports another id shows its sentence, is not handed on and keeps focus on the row", async () => {
    const rig = makeRig({ servers: two() });
    rig.transport.answer(ALPHA, publicInfo(ID_TWO, "Alpha"));
    await renderApp(rig);
    forgetFocus();
    await press("server-row-0");
    expect(statusText()).toBe(SENTENCES.notTheDiscoveredServer);
    expect(rig.handed).toEqual([]);
    expect(rig.confirm).not.toHaveBeenCalled();
    expect(rig.remembered.list()).toEqual([]);
    expect(focusClaim()).toBe("server-row-0");
  });

  it("T4-02 item 3: a typed private address with no scheme is probed over http and asks about the unencrypted connection", async () => {
    const rig = makeRig();
    rig.transport.answer(LAN, publicInfo(ID_ONE, "Nas"));
    await renderApp(rig);
    await typeAddress("192.168.1.5:8096");
    expect(rig.gateways.mock.calls[0]?.[0]).toBe(LAN);
    expect(rig.transport.requests[0]?.target).toMatchObject({ server: LAN });
    expect(screen.getByTestId("sign-in-unencrypted-cancel")).toBeTruthy();
    expect(rig.handed).toEqual([]);
  });

  it("T4-02 item 3: a typed public name with no scheme is probed over https", async () => {
    const rig = makeRig();
    rig.transport.answer(MEDIA, publicInfo(ID_ONE, "Media"));
    await renderApp(rig);
    await typeAddress("media.example.test");
    expect(handedAddresses(rig)).toEqual([MEDIA]);
  });
});

async function dialogFor(servers = [found(ID_ONE, LAN, "Nas")]): Promise<Rig> {
  const rig = makeRig({ servers });
  rig.transport.answer(LAN, publicInfo(ID_ONE, "Nas"));
  rig.transport.answer("http://192.168.1.5:8920", publicInfo(ID_ONE, "Nas"));
  await renderApp(rig);
  forgetFocus();
  await press("server-row-0");
  return rig;
}

describe("T4-02 item 4: the unencrypted connection", () => {
  it("T4-02 item 4: a private-LAN plain-HTTP server opens the warning with the server's name and exact origin, Cancel focused", async () => {
    const rig = await dialogFor();
    const dialog = within(openModal());
    expect(dialog.getByText(DIALOG.title)).toBeTruthy();
    expect(dialog.getByText("Nas")).toBeTruthy();
    expect(dialog.getByText(LAN)).toBeTruthy();
    expect(dialog.getByText(DIALOG.body)).toBeTruthy();
    expect(dialog.getByText(DIALOG.connect)).toBeTruthy();
    expect(dialog.getByText(DIALOG.cancel)).toBeTruthy();
    expect(screen.getByTestId("sign-in-unencrypted-cancel").props.hasTVPreferredFocus).toBe(true);
    expect(screen.getByTestId("sign-in-unencrypted-connect").props.hasTVPreferredFocus).toBeFalsy();
    expect(rig.handed).toEqual([]);
    expect(rig.confirm).not.toHaveBeenCalled();
  });

  it.each(["Cancel", "Back"])("T4-02 item 4: %s closes the warning, records and hands on nothing, and focus returns to the row", async (how) => {
    const rig = await dialogFor();
    forgetFocus();
    if (how === "Cancel") await press("sign-in-unencrypted-cancel");
    else await requestClose();
    await settle();
    expect(screen.queryByTestId("sign-in-unencrypted-cancel")).toBeNull();
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(rig.handed).toEqual([]);
    expect(rig.confirm).not.toHaveBeenCalled();
    expect(rig.remembered.list()).toEqual([]);
    expect(focusClaim()).toBe("server-row-0");
  });

  it("T4-02 item 4: Connect without encryption records the server and origin and hands it on", async () => {
    const rig = await dialogFor();
    await press("sign-in-unencrypted-connect");
    expect(rig.confirm).toHaveBeenCalledWith({ serverId: ID_ONE, origin: LAN });
    expect(handedAddresses(rig)).toEqual([LAN]);
  });

  it("T4-02 item 4: choosing the same server and origin again asks nothing; the same server at another port asks again", async () => {
    const rig = await dialogFor();
    await press("sign-in-unencrypted-connect");
    await press("fake-change-server");
    await press("server-row-0");
    expect(screen.queryByTestId("sign-in-unencrypted-cancel")).toBeNull();
    expect(screen.getByTestId("fake-later-step")).toBeTruthy();
    expect(rig.confirm).toHaveBeenCalledTimes(1);

    await press("fake-change-server");
    await press("sign-in-enter-address");
    await typeAddress("http://192.168.1.5:8920");
    expect(screen.getByTestId("sign-in-unencrypted-cancel")).toBeTruthy();
    expect(rig.confirm).toHaveBeenCalledTimes(1);
  });

  it("T4-02 item 4: a public plain-HTTP address is refused before any request", async () => {
    const rig = makeRig();
    await renderApp(rig);
    await typeAddress("http://media.example.com");
    expect(statusText()).toBe(SENTENCES.refusedPlainHttp);
    expect(rig.transport.requests).toEqual([]);
    expect(rig.transport.signIns).toEqual([]);
    expect(screen.queryByTestId("sign-in-unencrypted-cancel")).toBeNull();
    expect(rig.handed).toEqual([]);
  });
});

const planted = (code: ConstructorParameters<typeof TransportError>[0]) => Object.assign(new TransportError(code), { message: "CANARY-server-text" });

describe("T4-02 item 6: each failure shows its sentence", () => {
  it.each<[string, TransportResponse | Error, string]>([
    ["a network failure", planted("network"), SENTENCES.unreachable(MEDIA)],
    ["a timeout", planted("timeout"), SENTENCES.unreachable(MEDIA)],
    ["a redirect", planted("redirect"), SENTENCES.redirect],
    ["a 3xx answer", { status: 302, body: { message: "CANARY-server-text" } }, SENTENCES.redirect],
    ["a 503", { status: 503, body: { message: "CANARY-server-text" } }, SENTENCES.other],
    ["a 404", { status: 404, body: { message: "CANARY-server-text" } }, SENTENCES.other],
    ["an unusable answer", { status: 200, body: { message: "CANARY-server-text" } }, SENTENCES.other],
    ["an unsupported version", publicInfo(ID_ONE, "Media", "10.10.7-CANARY"), SENTENCES.unsupportedVersion],
    ["a refusal on https", planted("refused"), SENTENCES.other],
    ["an unknown error", new Error("CANARY-server-text"), SENTENCES.other],
  ])("T4-02 item 6: %s shows only Octave's sentence and returns focus to the field", async (_name, answer, sentence) => {
    const rig = makeRig();
    rig.transport.answer(MEDIA, answer);
    await renderApp(rig);
    forgetFocus();
    await typeAddress(MEDIA);
    expect(statusText()).toBe(sentence);
    expect(screen.getByTestId("sign-in-status").props.accessibilityLiveRegion).toBe("polite");
    expect(screenText()).not.toContain("CANARY");
    expect(rig.handed).toEqual([]);
    expect(rig.remembered.list()).toEqual([]);
    expect(focusClaim()).toBe("sign-in-address");
  });

  it("T4-02 item 6: the unreachable sentence names the address as the gateway normalised it", async () => {
    const rig = makeRig();
    await renderApp(rig);
    await typeAddress("https://media.example.test/jellyfin/");
    expect(statusText()).toBe(SENTENCES.unreachable("https://media.example.test/jellyfin"));
  });

  it("T4-02 item 6: a public plain-HTTP address shows the refused-plain-HTTP sentence", async () => {
    const rig = makeRig();
    await renderApp(rig);
    await typeAddress("http://media.example.com");
    expect(statusText()).toBe(SENTENCES.refusedPlainHttp);
  });

  it("T4-02 item 6: a gateway that cannot be built shows the general sentence", async () => {
    const rig = makeRig({
      gateways: async () => {
        throw new Error("CANARY-install-id");
      },
    });
    await renderApp(rig);
    await typeAddress(MEDIA);
    expect(statusText()).toBe(SENTENCES.other);
    expect(screenText()).not.toContain("CANARY");
  });

  it("T4-02 item 6: a cancelled request shows nothing", async () => {
    const rig = makeRig();
    rig.transport.answer(MEDIA, planted("cancelled"));
    await renderApp(rig);
    await typeAddress(MEDIA);
    expect(statusText()).toBeUndefined();
    expect(rig.handed).toEqual([]);
  });

  it("T4-02 item 6: a failure on a found row returns focus to that row", async () => {
    const rig = makeRig({ servers: two() });
    await renderApp(rig);
    forgetFocus();
    await press("server-row-1");
    expect(statusText()).toBe(SENTENCES.unreachable(BETA));
    expect(focusClaim()).toBe("server-row-1");
  });
});

describe("T4-02 item 8: https hosts that are not plain ASCII", () => {
  it("T4-02 item 8: typing a Unicode https host shows the characters sentence with no request", async () => {
    const rig = makeRig();
    await renderApp(rig);
    await typeAddress("https://bücher.example");
    expect(statusText()).toBe(SENTENCES.unicodeHost);
    expect(rig.transport.requests).toEqual([]);
    expect(rig.transport.signIns).toEqual([]);
    expect(rig.handed).toEqual([]);
  });

  it("T4-02 item 8: its punycode form is probed and handed on", async () => {
    const rig = makeRig();
    rig.transport.answer("https://xn--bcher-kva.example", publicInfo(ID_ONE, "Books"));
    await renderApp(rig);
    await typeAddress("https://xn--bcher-kva.example");
    expect(handedAddresses(rig)).toEqual(["https://xn--bcher-kva.example"]);
  });

  it("T4-02 item 8: a native refusal of an invalid xn-- host shows the not-an-address sentence", async () => {
    const rig = makeRig();
    rig.transport.answer("https://xn--a.example", new TransportError("refused"));
    await renderApp(rig);
    await typeAddress("https://xn--a.example");
    expect(statusText()).toBe(SENTENCES.notAnAddress);
    expect(rig.handed).toEqual([]);
  });
});

describe("T4-02 item 9: the found servers come from the source the screen is given", () => {
  it("T4-02 item 9: with the app's source until T4-01 there is no row and the address field shows", async () => {
    const rig = makeRig({ discovery: noServerDiscovery });
    await renderApp(rig);
    expect(rowIds()).toEqual([]);
    expect(screen.getByTestId("sign-in-address")).toBeTruthy();
    expect(preferredFocus()).toEqual(["sign-in-search-again"]);
    expect(screen.queryByText("On this network")).toBeNull();
  });

  it("T4-02 item 9: a source's servers are the rows, each with its name, address and advertiser", async () => {
    const rig = makeRig({
      servers: [found(ID_ONE, ALPHA, "Alpha", { advertisedBy: "192.168.1.20" }), found(ID_TWO, BETA, "Beta", { advertisedBy: "192.168.1.21", conflicting: true })],
    });
    await renderApp(rig);
    expect(screen.getByText("On this network")).toBeTruthy();
    const first = within(screen.getByTestId("server-row-0"));
    expect(first.getByText("Alpha")).toBeTruthy();
    expect(first.getByText(ALPHA)).toBeTruthy();
    expect(first.getByText("Advertised by 192.168.1.20")).toBeTruthy();
    expect(first.queryByText(CONFLICT_LINE)).toBeNull();
    const second = within(screen.getByTestId("server-row-1"));
    expect(second.getByText("Beta")).toBeTruthy();
    expect(second.getByText("Advertised by 192.168.1.21")).toBeTruthy();
    expect(second.getByText(CONFLICT_LINE)).toBeTruthy();
    expect(screen.queryByTestId("server-row-2")).toBeNull();
  });

  it("T4-02 item 3: an entered address is sent by the keyboard's action key, with no Connect button", async () => {
    const rig = makeRig({ discovery: noServerDiscovery });
    rig.transport.answer(MEDIA, publicInfo(ID_ONE, "Media"));
    await renderApp(rig);
    expect(screen.queryByText("Connect")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("sign-in-address-input"), MEDIA);
    expect(rig.transport.requests).toEqual([]);
    expect(screen.getByTestId("sign-in-address-input").props.returnKeyType).toBe("go");
    await fireEvent(screen.getByTestId("sign-in-address-input"), "submitEditing", { nativeEvent: { text: MEDIA } });
    await settle();
    expect(handedAddresses(rig)).toEqual([MEDIA]);
  });
});

describe("T4-02 item 10: an unsupported version on the screen", () => {
  it("T4-02 item 10: shows the copy table's sentence and none of the server's version", async () => {
    const rig = makeRig();
    rig.transport.answer(MEDIA, publicInfo(ID_ONE, "Media", "10.10.7-CANARY"));
    await renderApp(rig);
    await typeAddress(MEDIA);
    expect(statusText()).toBe(SENTENCES.unsupportedVersion);
    expect(screenText()).not.toContain("CANARY");
    expect(screenText()).not.toContain("10.10.7");
  });
});

describe("T4-02 item 12: a refused plain-HTTP name", () => {
  it("T4-02 item 12: a refusal of http://nas.local:8096 shows exactly the sentence of a public plain-HTTP address", async () => {
    const lan = makeRig();
    lan.transport.answer("http://nas.local:8096", new TransportError("refused"));
    const first = await renderApp(lan);
    await typeAddress("http://nas.local:8096");
    const refused = statusText();
    expect(refused).toBe(SENTENCES.refusedPlainHttp);
    expect(lan.transport.requests).toHaveLength(1);
    expect(lan.handed).toEqual([]);
    await first.unmount();

    const open = makeRig();
    await renderApp(open);
    await typeAddress("http://media.example.com");
    expect(statusText()).toBe(refused);
  });
});
