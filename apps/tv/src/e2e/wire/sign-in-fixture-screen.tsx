// The server step in fixed states, for the 1920×1080 captures (T4-02 D14): SignInApp over a fake server search and a
// transport that answers the probe from memory. The release app mounts no sign-in yet (D2), so only the e2e app draws
// these, after the player fixtures: two found servers under a remembered one, then no server found, then one found
// private-LAN server, which stays; select on its row opens the unencrypted-connection dialog. Nothing is sent.
import { MemoryLanHttpConfirmations } from "@octave/core/src/lan-http-confirmations";
import type { DiscoveredServer } from "@octave/core/src/domain/server-discovery";
import { TransportError, type Transport } from "@octave/core/src/ports/transport";
import { MemoryRememberedServers, type RememberedServer } from "@octave/core/src/remembered-servers";
import type { ReactElement } from "react";
import { hostCrypto } from "../../host/crypto";
import { createGatewayFactory } from "../../host/gateway";
import { SignInApp, type SignInServices } from "../../sign-in";
import { wait } from "./wire-context";

// Long enough to capture each state before the next replaces it.
const STATE_HOLD_MS = 20_000;

const PRIVATE_LAN_ID = "0123456789abcdef0123456789abcdef";

const discovered = (id: string, name: string, address: string): DiscoveredServer => ({
  id,
  name,
  address,
  advertisedBy: "192.168.1.5",
  addressIsSender: true,
  conflicting: false,
});

const privateLanServer = discovered(PRIVATE_LAN_ID, "Fixture Server", "http://192.168.1.5:8096");
const secondServer = discovered("fedcba9876543210fedcba9876543210", "Second Fixture Server", "http://nas.local:8096");
const rememberedServer: RememberedServer = {
  id: "00112233445566778899aabbccddeeff",
  name: "Remembered Fixture Server",
  address: "https://media.example.test",
};

// Answers only the credential-free probe, as the private-LAN server; it opens no connection.
const memoryTransport: Transport = {
  signIn: async () => {
    throw new TransportError("refused");
  },
  request: async () => ({ status: 200, body: { ServerName: privateLanServer.name, Version: "10.11.11", Id: PRIVATE_LAN_ID } }),
  endSession: async () => undefined,
};

const gateways = createGatewayFactory({ crypto: hostCrypto, transport: memoryTransport, installId: async () => "22222222-2222-4222-8222-222222222222" });

function servicesWith(servers: DiscoveredServer[], remembered: RememberedServer[]): SignInServices {
  const store = new MemoryRememberedServers();
  for (const server of remembered) store.remember(server);
  return {
    discovery: { discover: async () => ({ servers, refused: 0, dropped: 0 }) },
    gateways,
    confirmations: new MemoryLanHttpConfirmations(),
    remembered: store,
    // A stray Back must not close the app between captures.
    leave: () => undefined,
  };
}

const STATES = [
  { id: "found", services: servicesWith([privateLanServer, secondServer], [rememberedServer]) },
  { id: "none-found", services: servicesWith([], []) },
  { id: "unencrypted", services: servicesWith([privateLanServer], []) },
];

// No capture goes past the server step.
const NoLaterStep = () => null;

export async function showSignInFixtures(show: (element: ReactElement | null) => Promise<void>, log: (line: string) => void): Promise<void> {
  for (const [index, state] of STATES.entries()) {
    if (index > 0) await wait(STATE_HOLD_MS);
    await show(<SignInApp key={state.id} services={state.services} nextStep={NoLaterStep} />);
    log(`OCTAVE_FIXTURE sign-in=${state.id}`);
  }
}
