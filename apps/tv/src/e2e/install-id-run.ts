// The app's side of pnpm tv:e2e's install-id stage (T4-09): read the install id, build two gateways with the app's one
// factory over an in-memory Transport, sign each in, and write whether both sent the DeviceId the stored id derives,
// with a mark of it. The host relaunches, clears and restores the app and compares the marks (scripts/tv-install-id.mjs).
// Lines hold fixed words and the mark only: never the id, a DeviceId or an error message. Nothing reaches the network.
// No React, React Native or Expo import, so Node runs it in scripts/tv-install-id.test.ts.
import { deriveDeviceId } from "@octave/core/src/jellyfin/device-id";
import type { Crypto } from "@octave/core/src/ports/crypto";
import type { Transport } from "@octave/core/src/ports/transport";
import { createGatewayFactory } from "../host/gateway";
import { isInstallId, type InstallIdSource } from "../host/install-id";

const SERVER = "https://octave-e2e.invalid";
const SERVER_ID = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const USER = "octave-e2e-user";
const PREFIX = "OCTAVE_INSTALL";

// Answers the public-info probe and a sign-in in memory and keeps the DeviceId of each sign-in.
function recordingTransport(deviceIds: string[]): Transport {
  return {
    async signIn(request) {
      deviceIds.push(request.deviceId);
      return { session: "octave-e2e-session", userId: "octave-e2e-user-id", userName: USER, serverId: SERVER_ID };
    },
    async request() {
      return { status: 200, body: { Version: "10.11.0", Id: SERVER_ID, ServerName: "Octave e2e" } };
    },
    async endSession() {},
  };
}

export async function runInstallId(host: { crypto: Crypto; installId: InstallIdSource }, log: (line: string) => void): Promise<void> {
  log(`${PREFIX} start`);
  try {
    const id = await host.installId();
    const deviceIds: string[] = [];
    const factory = createGatewayFactory({ crypto: host.crypto, transport: recordingTransport(deviceIds), installId: host.installId });
    for (let i = 0; i < 2; i += 1) {
      const gateway = await factory(SERVER);
      await gateway.connect();
      await gateway.login(USER, "octave-e2e-password");
    }
    const expected = await deriveDeviceId(host.crypto, id, SERVER_ID, USER);
    const stable = deviceIds.length === 2 && deviceIds[0] === deviceIds[1] && deviceIds[0] === expected;
    const mark = (await host.crypto.sha256Hex(`octave-e2e-mark:${deviceIds[0] ?? ""}`)).slice(0, 16);
    log(`${PREFIX} id shape=${isInstallId(id) ? "ok" : "bad"} stable=${stable ? "yes" : "no"} mark=${mark}`);
  } catch {
    log(`${PREFIX} threw`);
  }
  log(`${PREFIX} done`);
}
