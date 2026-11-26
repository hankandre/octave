// T8-04: the artwork the app is given draws the player's loading backdrop, as it draws Home's art.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react-native";
import { createFakePlayerEngine } from "@octave/core/src/player/fake-player-engine";
import { FakeClock } from "@octave/core/src/ports/fake-clock";
import type { ReactElement } from "react";
import { View } from "react-native";
import { ArtworkProvider, type ArtworkComponent } from "../design/rows/artwork";
import { ReducedMotionProvider } from "../design/motion";
import { pressSelect } from "../design/test-support/select-key";
import { NOW, art, detailOf } from "../home/test-support/home-doubles";
import { resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import { SignedInApp } from "./signed-in-app";
import { SERVER_NAME, fakeGateway, settle } from "./test-support/signed-in-doubles";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));
jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const BACKDROP = art("ep-2", "Backdrop", "player-backdrop");

/** The signed-in app with a title that has a backdrop, taken to the loading player. */
async function loadingPlayer(app: (gateway: ReturnType<typeof fakeGateway>) => ReactElement): Promise<void> {
  const gateway = fakeGateway();
  const detail = gateway.itemDetail.getMockImplementation();
  gateway.itemDetail.mockImplementation(async (id) => ({ ...(detail ? await detail(id) : detailOf(id, {})), backdrop: BACKDROP }));
  await render(<ReducedMotionProvider value>{app(gateway)}</ReducedMotionProvider>);
  await settle();

  await pressSelect(screen.getByTestId("home-hero-primary"));
  await settle();
}

const signedInApp = (gateway: ReturnType<typeof fakeGateway>, Artwork?: ArtworkComponent) => (
  <SignedInApp
    gateway={gateway as never}
    serverName={SERVER_NAME}
    engine={createFakePlayerEngine().engine}
    PlayerView={View}
    clock={new FakeClock(NOW)}
    Artwork={Artwork}
  />
);

const Drawn: ArtworkComponent = ({ image }) => <View testID={`drawn-${image.tag}`} />;

const expectBackdropDrawn = (): void => {
  expect(within(screen.getByTestId("player-screen")).getByTestId("drawn-player-backdrop")).toBeTruthy();
};

describe("T8-04: the signed-in app's artwork", () => {
  it("draws the item's backdrop on the loading player", async () => {
    await loadingPlayer((gateway) => signedInApp(gateway, Drawn));

    expectBackdropDrawn();
  });

  it("keeps an outer provider's artwork when the app is given none", async () => {
    await loadingPlayer((gateway) => <ArtworkProvider component={Drawn}>{signedInApp(gateway)}</ArtworkProvider>);

    expectBackdropDrawn();
  });
});
