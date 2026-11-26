// What the signed-out flow needs from the app (T4-02 D4, D8): the composition root wires it, and a screen constructs no
// gateway (DOMAINS.md §8).
import { createContext } from "react";
import type { ServerDiscovery } from "@octave/core/src/domain/server-discovery";
import type { SignInMethods } from "@octave/core/src/domain/sign-in-methods";
import type { ServerConnection } from "@octave/core/src/domain/server-connection";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import type { LanHttpConfirmationStore } from "@octave/core/src/lan-http-confirmations";
import type { RememberedServers } from "@octave/core/src/remembered-servers";
import type { GatewayFactory } from "../host/gateway";

export type SignInServices = {
  discovery: ServerDiscovery;
  gateways: GatewayFactory;
  confirmations: LanHttpConfirmationStore;
  remembered: RememberedServers;
  /** What Back on the first step does; without it the app exits. */
  leave?: () => void;
  /** How the chosen server lets a viewer sign in; without it, `DEFAULT_SIGN_IN_METHODS`. */
  signInMethods?: (chosen: ChosenServer) => SignInMethods;
};

/** The server the viewer chose, handed to every later sign-in step. `address` is the gateway's `serverUrl`. */
export type ChosenServer = {
  gateway: JellyfinGateway;
  serverName: string;
  address: string;
};

/** What a finished sign-in hands the app: the gateway that now holds the session. */
export type SignedIn = { gateway: JellyfinGateway; serverName: string };

export type NextStepProps = {
  chosen: ChosenServer;
  changeServer(): void;
  onSignedIn?(signedIn: SignedIn): void;
  /** Hands over to the password step because this server offers no Quick Connect, when the flow has one. */
  openPassword?(): void;
  /** The viewer chose to type a password instead, when the flow offers one. Back returns to this step. */
  choosePassword?(): void;
};

export type PasswordStepProps = {
  chosen: ChosenServer;
  changeServer(): void;
  onSignedIn(signedIn: SignedIn): void;
  /** The account's name after a confirmed revoke (T4-05 D8): Username starts filled, focus opens on Password, and an
   * empty password is held until a field is edited. */
  initialUsername?: string;
};

/** Where sign-in starts after a restore found the stored session revoked (T4-05 D8): that server, and the user's name. */
export type SignInStart = { gateway: JellyfinGateway; connection: ServerConnection; username?: string };

export const SignInServicesContext = createContext<SignInServices | undefined>(undefined);

export const ChosenServerContext = createContext<ChosenServer | undefined>(undefined);
