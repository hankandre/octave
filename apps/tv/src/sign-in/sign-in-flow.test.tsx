// T4-02 items 5 and 7 (docs/specs/T4-02.md, D6, D8): the origin chip on every later step, and the remembered servers on
// a later visit. A fake later step is built on the frame, as T4-03's step will be.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react-native";
import type { DiscoveryResult } from "@octave/core/src/domain/server-discovery";
import {
  ID_ONE,
  ID_TWO,
  captureBack,
  deferred,
  focusClaim,
  forgetFocus,
  found,
  makeRig,
  preferredFocus,
  press,
  publicInfo,
  renderApp,
  rowIds,
  sentElsewhere,
  settle,
  textIn,
  typeAddress,
} from "./test-support/sign-in-doubles";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

const ALPHA = "https://alpha.example.test";
const BETA = "https://beta.example.test";
const MEDIA = "https://media.example.test:8920/jellyfin";

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  forgetFocus();
  captureBack();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("T4-02 item 5: the server's origin on every later step", () => {
  it("T4-02 item 5: the chip shows the normalised address in full, and after Change server it shows the new one", async () => {
    const rig = makeRig();
    rig.transport.answer(MEDIA, publicInfo(ID_ONE, "Media"));
    rig.transport.answer(ALPHA, publicInfo(ID_TWO, "Alpha"));
    await renderApp(rig);
    expect(screen.queryByTestId("sign-in-origin-chip")).toBeNull();

    await typeAddress(`${MEDIA}/`);
    expect(screen.getByRole("header", { name: "Fake later step" })).toBeTruthy();
    expect(textIn("sign-in-origin-chip")).toBe(MEDIA);
    expect(screen.getByTestId("sign-in-origin-chip").props.accessibilityLabel).toBe(`Server ${MEDIA}`);

    await press("fake-change-server");
    expect(screen.queryByTestId("sign-in-origin-chip")).toBeNull();

    await press("sign-in-enter-address");
    await typeAddress(ALPHA);
    expect(textIn("sign-in-origin-chip")).toBe(ALPHA);
    expect(screen.getByTestId("sign-in-origin-chip").props.accessibilityLabel).toBe(`Server ${ALPHA}`);
  });
});

describe("T4-02 item 7: remembered servers are listed first on a later visit", () => {
  const two = () => [found(ID_ONE, ALPHA, "Alpha"), found(ID_TWO, BETA, "Beta")];

  async function chooseSecond() {
    const rig = makeRig({ servers: two() });
    rig.transport.answer(ALPHA, publicInfo(ID_ONE, "Alpha"));
    rig.transport.answer(BETA, publicInfo(ID_TWO, "Beta"));
    const view = await renderApp(rig);
    await press("server-row-1");
    return { rig, view };
  }

  it("T4-02 item 7: the chosen server is remembered with its id, name and address", async () => {
    const { rig } = await chooseSecond();
    expect(rig.remembered.list()).toEqual([{ id: ID_TWO, name: "Beta", address: BETA }]);
  });

  it("T4-02 item 7: after Change server it is the first row with focus, above the other found row, and listed once", async () => {
    await chooseSecond();
    forgetFocus();
    await press("fake-change-server");
    expect(rowIds()).toEqual(["server-row-0", "server-row-1"]);
    expect(within(screen.getByTestId("server-row-0")).getByText(BETA)).toBeTruthy();
    expect(within(screen.getByTestId("server-row-1")).getByText(ALPHA)).toBeTruthy();
    expect(screen.getAllByText(BETA)).toHaveLength(1);
    expect(screen.getByText("On this network")).toBeTruthy();
    expect(focusClaim()).toBe("server-row-0");
  });

  it("T4-02 item 7: a step mounted again with the same services lists it first", async () => {
    const { rig, view } = await chooseSecond();
    await view.unmount();
    forgetFocus();
    await renderApp(rig);
    expect(within(screen.getByTestId("server-row-0")).getByText(BETA)).toBeTruthy();
    expect(preferredFocus()).toEqual(["server-row-0"]);
  });

  it("T4-02 item 7: found servers that arrive late are listed below and never move focus", async () => {
    const search = deferred<DiscoveryResult>();
    const rig = makeRig({ discovery: { discover: jest.fn(() => search.promise) } });
    rig.remembered.remember({ id: ID_TWO, name: "Beta", address: BETA });
    await renderApp(rig);
    expect(rowIds()).toEqual(["server-row-0"]);
    expect(preferredFocus()).toEqual(["server-row-0"]);

    forgetFocus();
    search.resolve({ servers: two(), refused: 0, dropped: 0 });
    await settle();
    expect(rowIds()).toEqual(["server-row-0", "server-row-1"]);
    expect(within(screen.getByTestId("server-row-1")).getByText(ALPHA)).toBeTruthy();
    expect(sentElsewhere("server-row-0")).toEqual([]);
  });

  it("T4-02 item 7: a server whose probe reports no id is not remembered", async () => {
    const rig = makeRig();
    rig.transport.answer(ALPHA, publicInfo(undefined, "Alpha"));
    await renderApp(rig);
    await typeAddress(ALPHA);
    expect(screen.getByTestId("fake-later-step")).toBeTruthy();
    expect(rig.remembered.list()).toEqual([]);
  });
});
