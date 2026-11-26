// The Quick Connect step in fixed states, for the 1920×1080 captures (T4-03 D13): the real step over a transport that
// answers from memory. The states are a code with its QR code, a code with no approval link (a loopback server), an
// expired code and a refused code. Failures show once the first poll has run. Nothing is sent.
import { MemoryLanHttpConfirmations } from "@octave/core/src/lan-http-confirmations";
import type { Transport } from "@octave/core/src/ports/transport";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "../../design/tokens";
import { hostClock } from "../../host/clock";
import { hostCrypto } from "../../host/crypto";
import { createGatewayFactory } from "../../host/gateway";
import { createQuickConnectStep } from "../../sign-in";
import { ChosenServerContext, type ChosenServer } from "../../sign-in/sign-in-services";
import { wait } from "./wire-context";

// Long enough for a first poll and a capture.
const STATE_HOLD_MS = 20_000;
const LAN = "http://192.168.1.5:8096";
const LOOPBACK = "http://127.0.0.1:8096";

const QuickConnectStep = createQuickConnectStep({ clock: hostClock });
const stay = () => undefined;

const ANSWERS: Record<string, unknown> = {
  "/System/Info/Public": { ServerName: "Fixture Server", Version: "10.11.11", Id: "0123456789abcdef0123456789abcdef" },
  "/QuickConnect/Enabled": true,
  "/QuickConnect/Initiate": { Secret: "0123456789abcdef".repeat(4), Code: "482913" },
  "/QuickConnect/Connect": { Authenticated: false },
};

// `pollStatus` is what every poll is answered with; it opens no connection.
const memoryTransport = (pollStatus: number): Transport => ({
  signIn: () => new Promise(() => undefined),
  request: async ({ path }) => ({ status: path === "/QuickConnect/Connect" ? pollStatus : 200, body: ANSWERS[path] }),
  endSession: async () => undefined,
});

async function chosenServer(address: string, pollStatus: number): Promise<ChosenServer> {
  const gateways = createGatewayFactory({ crypto: hostCrypto, transport: memoryTransport(pollStatus), installId: async () => "22222222-2222-4222-8222-222222222222" });
  const gateway = await gateways(address, { confirmations: new MemoryLanHttpConfirmations() });
  const connection = await gateway.connect();
  gateway.confirmUnencryptedConnection();
  return { gateway, serverName: connection.name, address: gateway.serverUrl };
}

const quickConnect = (chosen: ChosenServer) => <QuickConnectStep chosen={chosen} changeServer={stay} />;

const STATES = [
  { id: "waiting-qr", address: LAN, pollStatus: 200, step: quickConnect },
  { id: "waiting-no-link", address: LOOPBACK, pollStatus: 200, step: quickConnect },
  { id: "expired", address: LAN, pollStatus: 404, step: quickConnect },
  { id: "refused", address: LAN, pollStatus: 401, step: quickConnect },
];

export async function showQuickConnectFixtures(show: (element: ReactElement | null) => Promise<void>, log: (line: string) => void): Promise<void> {
  for (const state of STATES) {
    const chosen = await chosenServer(state.address, state.pollStatus);
    await show(
      <View key={state.id} style={styles.screen}>
        <ChosenServerContext.Provider value={chosen}>{state.step(chosen)}</ChosenServerContext.Provider>
      </View>,
    );
    log(`OCTAVE_FIXTURE quick-connect=${state.id}`);
    await wait(STATE_HOLD_MS);
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
