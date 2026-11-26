// The Quick Connect and password steps in fixed states, for the 1920×1080 captures (T4-03 D13, T4-04 D10): the real
// steps over a transport that answers from memory. The Quick Connect states are a code with its QR code, a code with no
// approval link (a loopback server), an expired code, a refused code and a code beside "Use a password". Failures show
// once the first poll has run. The password states open on an empty step; the capture run reaches `password-shown` and
// `password-wrong` with the remote's keys, and every sign-in is refused with a 401 and logged, so a press that sends a
// second one shows. Nothing is sent.
import { MemoryLanHttpConfirmations } from "@octave/core/src/lan-http-confirmations";
import { TransportError, type Transport } from "@octave/core/src/ports/transport";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "../../design/tokens";
import { hostClock } from "../../host/clock";
import { hostCrypto } from "../../host/crypto";
import { createGatewayFactory } from "../../host/gateway";
import { createQuickConnectStep, PasswordStep } from "../../sign-in";
import { ChosenServerContext, type ChosenServer } from "../../sign-in/sign-in-services";
import { wait } from "./wire-context";

// Long enough for a first poll and a capture.
const STATE_HOLD_MS = 20_000;
// Long enough to type with the remote's keys and capture.
const TYPED_HOLD_MS = 240_000;
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

type Log = (line: string) => void;

// One line per sign-in. It holds a count and whether the password was empty, never what was typed.
function refuseEverySignIn(log: Log): Transport["signIn"] {
  let count = 0;
  return async ({ credential }) => {
    count += 1;
    const isEmpty = credential.kind === "password" && credential.password === "";
    log(`OCTAVE_FIXTURE password-sign-in=${count} empty-password=${isEmpty}`);
    throw new TransportError("status", 401);
  };
}

// `pollStatus` is what every poll is answered with; it opens no connection.
const memoryTransport = (pollStatus: number, log: Log): Transport => ({
  signIn: refuseEverySignIn(log),
  request: async ({ path }) => ({ status: path === "/QuickConnect/Connect" ? pollStatus : 200, body: ANSWERS[path] }),
  endSession: async () => undefined,
});

async function chosenServer(address: string, pollStatus: number, log: Log): Promise<ChosenServer> {
  const gateways = createGatewayFactory({ crypto: hostCrypto, transport: memoryTransport(pollStatus, log), installId: async () => "22222222-2222-4222-8222-222222222222" });
  const gateway = await gateways(address, { confirmations: new MemoryLanHttpConfirmations() });
  const connection = await gateway.connect();
  gateway.confirmUnencryptedConnection();
  return { gateway, serverName: connection.name, address: gateway.serverUrl };
}

const quickConnect = (chosen: ChosenServer) => <QuickConnectStep chosen={chosen} changeServer={stay} />;
const quickConnectWithPassword = (chosen: ChosenServer) => <QuickConnectStep chosen={chosen} changeServer={stay} choosePassword={stay} />;
const password = (chosen: ChosenServer) => <PasswordStep chosen={chosen} changeServer={stay} onSignedIn={stay} />;

const STATES = [
  { id: "waiting-qr", address: LAN, pollStatus: 200, step: quickConnect, holdMs: STATE_HOLD_MS },
  { id: "waiting-no-link", address: LOOPBACK, pollStatus: 200, step: quickConnect, holdMs: STATE_HOLD_MS },
  { id: "expired", address: LAN, pollStatus: 404, step: quickConnect, holdMs: STATE_HOLD_MS },
  { id: "refused", address: LAN, pollStatus: 401, step: quickConnect, holdMs: STATE_HOLD_MS },
  { id: "quick-connect-use-password", address: LAN, pollStatus: 200, step: quickConnectWithPassword, holdMs: STATE_HOLD_MS },
  { id: "password-empty", address: LAN, pollStatus: 200, step: password, holdMs: STATE_HOLD_MS },
  { id: "password-shown", address: LAN, pollStatus: 200, step: password, holdMs: TYPED_HOLD_MS },
  { id: "password-wrong", address: LAN, pollStatus: 200, step: password, holdMs: TYPED_HOLD_MS },
];

export async function showQuickConnectFixtures(show: (element: ReactElement | null) => Promise<void>, log: Log): Promise<void> {
  for (const state of STATES) {
    const chosen = await chosenServer(state.address, state.pollStatus, log);
    await show(
      <View key={state.id} style={styles.screen}>
        <ChosenServerContext.Provider value={chosen}>{state.step(chosen)}</ChosenServerContext.Provider>
      </View>,
    );
    log(`OCTAVE_FIXTURE quick-connect=${state.id}`);
    await wait(state.holdMs);
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
