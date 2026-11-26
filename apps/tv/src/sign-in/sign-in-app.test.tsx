// T4-02 item 11 (docs/specs/T4-02.md, D11, R3): what Back does on each sign-in step, and that no press reaches Home or
// the rail. Android sends Back to an open Modal's `onRequestClose`, not to `BackHandler`.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react-native";
import type { TransportResponse } from "@octave/core/src/ports/transport";
import type { GatewayFactory } from "../host/gateway";
import {
  ID_ONE,
  ID_TWO,
  captureBack,
  deferred,
  focusClaim,
  forgetFocus,
  found,
  makeRig,
  press,
  publicInfo,
  renderApp,
  requestClose,
  rowIds,
  sentElsewhere,
  settle,
  statusText,
  typeAddress,
} from "./test-support/sign-in-doubles";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

const ALPHA = "https://alpha.example.test";
const BETA = "https://beta.example.test";
const LAN = "http://192.168.1.5:8096";

let back: ReturnType<typeof captureBack>;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  forgetFocus();
  back = captureBack();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const two = () => [found(ID_ONE, ALPHA, "Alpha"), found(ID_TWO, BETA, "Beta")];

function expectNoShell(): void {
  expect(screen.queryAllByTestId(/^(rail|rail-entry-.*|screen-home)$/, { includeHiddenElements: true })).toEqual([]);
}

/** Presses Back and checks what holds after every press: it was handled, and no shell appeared. */
async function pressBack(): Promise<void> {
  expect(await back.back()).toBe(true);
  expectNoShell();
}

describe("T4-02 item 11: Back on a sign-in step", () => {
  it("T4-02 item 11: on step 1 it leaves the app, with no question", async () => {
    const leave = jest.fn();
    const rig = makeRig({ servers: two(), leave });
    await renderApp(rig);
    expectNoShell();
    await pressBack();
    expect(leave).toHaveBeenCalledTimes(1);
    expect(back.exitApp).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sign-in-unencrypted-cancel")).toBeNull();
  });

  it("T4-02 item 11: with no leave given, it leaves through BackHandler.exitApp", async () => {
    const rig = makeRig();
    await renderApp(rig);
    await pressBack();
    expect(back.exitApp).toHaveBeenCalledTimes(1);
  });

  it("T4-02 item 11: with the address field revealed it leaves as on the rest of step 1, and the field stays", async () => {
    const leave = jest.fn();
    const rig = makeRig({ servers: two(), leave });
    await renderApp(rig);
    await press("sign-in-enter-address");
    await pressBack();
    expect(leave).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sign-in-address")).toBeTruthy();
  });

  it("T4-02 item 11: with the warning open, Back reaches the dialog alone, which closes as Cancel", async () => {
    const leave = jest.fn();
    const rig = makeRig({ servers: [found(ID_ONE, LAN, "Nas")], leave });
    rig.transport.answer(LAN, publicInfo(ID_ONE, "Nas"));
    await renderApp(rig);
    await press("server-row-0");
    expect(screen.getByTestId("sign-in-unencrypted-cancel")).toBeTruthy();

    forgetFocus();
    const listenerCalls = back.seen.calls;
    await requestClose();
    await settle();
    expect(screen.queryByTestId("sign-in-unencrypted-cancel")).toBeNull();
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(back.seen.calls).toBe(listenerCalls);
    expect(leave).not.toHaveBeenCalled();
    expect(rig.handed).toEqual([]);
    expect(rig.confirm).not.toHaveBeenCalled();
    expect(rig.remembered.list()).toEqual([]);
    expect(focusClaim()).toBe("server-row-0");
    expectNoShell();
  });

  it("T4-02 item 11: while the gateway is still being built, Back cancels the probe and stays, and the late gateway is never probed", async () => {
    const leave = jest.fn();
    const gate = deferred<Awaited<ReturnType<GatewayFactory>>>();
    const rig = makeRig({ servers: two(), leave, gateways: () => gate.promise });
    await renderApp(rig);
    await press("server-row-0");
    forgetFocus();
    await pressBack();
    expect(leave).not.toHaveBeenCalled();
    expect(statusText()).toBeUndefined();
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(sentElsewhere("server-row-0")).toEqual([]);

    gate.resolve(await rig.real(ALPHA, { confirmations: rig.confirmations }));
    await settle();
    expect(rig.transport.requests).toEqual([]);
    expect(rig.handed).toEqual([]);
    expect(statusText()).toBeUndefined();

    await pressBack();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("T4-02 item 11: while the server is being asked, Back aborts the request, shows nothing and stays", async () => {
    const leave = jest.fn();
    const rig = makeRig({ servers: two(), leave });
    const pending = deferred<TransportResponse>();
    rig.transport.answer(ALPHA, pending.promise);
    await renderApp(rig);
    await press("server-row-0");
    expect(rig.transport.requests).toHaveLength(1);
    forgetFocus();
    await pressBack();
    expect(rig.transport.requests[0]?.signal?.aborted).toBe(true);
    expect(leave).not.toHaveBeenCalled();
    expect(statusText()).toBeUndefined();
    expect(sentElsewhere("server-row-0")).toEqual([]);

    pending.resolve(publicInfo(ID_ONE, "Alpha"));
    await settle();
    expect(rig.handed).toEqual([]);
    expect(rig.remembered.list()).toEqual([]);
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();

    await pressBack();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("T4-02 item 11: after Back cancels a probe, another server can be chosen", async () => {
    const rig = makeRig({ servers: two(), leave: jest.fn() });
    rig.transport.answer(ALPHA, deferred<TransportResponse>().promise);
    rig.transport.answer(BETA, publicInfo(ID_TWO, "Beta"));
    await renderApp(rig);
    await press("server-row-0");
    await pressBack();
    await press("server-row-1");
    expect(rig.handed.map((server) => server.address)).toEqual([BETA]);
  });

  it("T4-02 item 11: on a later step it returns to step 1 with focus on the row that chose the server", async () => {
    const leave = jest.fn();
    const rig = makeRig({ servers: two(), leave });
    rig.transport.answer(BETA, publicInfo(ID_TWO, "Beta"));
    await renderApp(rig);
    await press("server-row-1");
    expect(screen.getByTestId("fake-later-step")).toBeTruthy();
    expectNoShell();

    forgetFocus();
    await pressBack();
    expect(leave).not.toHaveBeenCalled();
    expect(back.exitApp).not.toHaveBeenCalled();
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(screen.queryByTestId("fake-later-step")).toBeNull();
    const claimed = rowIds().find((id) => id === focusClaim());
    expect(claimed).toBeDefined();
    expect(within(screen.getByTestId(String(claimed))).getByText(BETA)).toBeTruthy();

    await pressBack();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("T4-02 item 11: on a later step reached by a typed address, it returns to step 1 and never leaves", async () => {
    const leave = jest.fn();
    const rig = makeRig({ leave });
    rig.transport.answer(ALPHA, publicInfo(ID_ONE, "Alpha"));
    await renderApp(rig);
    await typeAddress(ALPHA);
    await pressBack();
    expect(screen.getByTestId("sign-in-server-step")).toBeTruthy();
    expect(leave).not.toHaveBeenCalled();
  });
});
