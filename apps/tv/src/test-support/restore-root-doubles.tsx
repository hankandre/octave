// Doubles for the T4-05 app-root tests (docs/specs/T4-05.md, D7 to D9). They build on the frozen sign-in and signed-in
// doubles and edit none.
//
// Testing contract (the implementer builds to it)
// - `AppRoot` (../app-root) takes `{ signIn, signedInParts, restore?, account? }`.
//   - `restore()` answers the core's restore outcome (@octave/core/src/jellyfin/restore-session): { kind: "none" },
//     { kind: "signed-in", gateway, serverName }, { kind: "sign-in-again", gateway, connection, userName? } or
//     { kind: "unavailable", address, failure }. Without `restore`, AppRoot is as T4-03 built it.
//   - `account` is `{ activate(gateway), deactivate() }`; either may return a promise, and a rejection is dropped.
//   - `signIn` is drawn with `{ onSignedIn, start? }`; `start` is `{ gateway, connection, username? }` after a confirmed
//     revoke and absent otherwise. `SignInApp` takes the same optional `start` and hands it to its flow.
//   - `SignedInApp` gets the parts `signedInParts` answered plus `signOut`, a function.
// - testIDs: restore-loading (the "Loading…" screen), restore-unavailable (the unavailable screen's root),
//   restore-unavailable-sentence (its sentence, with the header role), restore-try-again and restore-change-server (its
//   buttons, in that order).
import { jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { View } from "react-native";
import type { ServerConnection } from "@octave/core/src/domain/server-connection";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { createFakePlayerEngine } from "@octave/core/src/player/fake-player-engine";
import { FakeClock } from "@octave/core/src/ports/fake-clock";
import { AppRoot } from "../app-root";
import { ReducedMotionProvider } from "../design/motion";
import { NOW } from "../home/test-support/home-doubles";
import { SignInApp } from "../sign-in/sign-in-app";
import type { NextStepProps, PasswordStepProps, SignedIn, SignInServices } from "../sign-in/sign-in-services";
import type { SignedInAppProps } from "../signed-in/signed-in-app";
import { settle } from "../sign-in/test-support/sign-in-doubles";

export type SignInStart = { gateway: JellyfinGateway; connection: ServerConnection; username?: string };
export type SignInProps = { onSignedIn(signedIn: SignedIn): void; start?: SignInStart };

export type RestoreOutcome =
  | { kind: "none" }
  | { kind: "signed-in"; gateway: JellyfinGateway; serverName: string }
  | { kind: "sign-in-again"; gateway: JellyfinGateway; connection: ServerConnection; userName?: string }
  | { kind: "unavailable"; address: string; failure: string };

export type Account = { activate(gateway: JellyfinGateway): Promise<void> | void; deactivate(): Promise<void> | void };

export function makeParts() {
  const player = createFakePlayerEngine();
  const parts = jest.fn(
    (signedIn: SignedIn): SignedInAppProps => ({
      gateway: signedIn.gateway,
      serverName: signedIn.serverName,
      engine: player.engine,
      PlayerView: View,
      clock: new FakeClock(NOW),
    }),
  );
  return parts;
}

/** The sign-in the root draws: the real SignInApp over `services`, recording each `start` it is drawn with. */
export function signInOver(services: SignInServices, nextStep: ComponentType<NextStepProps>, passwordStep?: ComponentType<PasswordStepProps>) {
  const drawn = jest.fn<(start: SignInStart | undefined) => void>();
  function SignIn({ onSignedIn, start }: SignInProps) {
    drawn(start);
    const props = { services, nextStep, passwordStep, onSignedIn, start } as Parameters<typeof SignInApp>[0];
    return <SignInApp {...props} />;
  }
  return { SignIn, drawn };
}

type RootProps = {
  signIn: ComponentType<SignInProps>;
  signedInParts: (signedIn: SignedIn) => SignedInAppProps;
  restore?: () => Promise<RestoreOutcome>;
  account?: Account;
};

export async function renderRoot(props: RootProps) {
  const Root = AppRoot as unknown as ComponentType<RootProps>;
  const view = await render(
    <ReducedMotionProvider value>
      <Root {...props} />
    </ReducedMotionProvider>,
  );
  await settle();
  return view;
}

export function deferredOutcome() {
  let resolve!: (outcome: RestoreOutcome) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<RestoreOutcome>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
