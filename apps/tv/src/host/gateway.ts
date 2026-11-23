// The one place under apps/tv that builds a JellyfinGateway (T4-09). Every gateway takes the stored install id, so the
// DeviceId for a server and user is the same after a relaunch; ESLint fails a construction or a value import of the
// class anywhere else. The only value imports are the core's gateway and capability reader, so Node can load this
// file; the wired factory is hostGateway in ./host-gateway.ts, built with createAppGatewayFactory (T8-07).
import { readCapabilities } from "@octave/core/src/domain/player-capabilities";
import type { PlayerCapabilities } from "@octave/core/src/domain/player-engine";
import { JellyfinGateway, type DeviceCapabilitySource } from "@octave/core/src/jellyfin/gateway";
import type { LanHttpConfirmationStore } from "@octave/core/src/lan-http-confirmations";
import type { Crypto } from "@octave/core/src/ports/crypto";
import type { StreamingLimitStore } from "@octave/core/src/streaming-limits";
import type { Transport } from "@octave/core/src/ports/transport";
import { isInstallId, type InstallIdSource } from "./install-id";

export interface GatewayHost {
  crypto: Crypto;
  transport: Transport;
  installId: InstallIdSource;
}

export interface GatewayStores {
  confirmations?: LanHttpConfirmationStore;
  streamingLimits?: StreamingLimitStore;
  deviceCapabilities?: DeviceCapabilitySource;
}

export type GatewayFactory = (serverUrl: string, stores?: GatewayStores) => Promise<JellyfinGateway>;

// Rejects, building nothing, when the install id is not available or not a version 4 UUID: an undefined fourth
// argument would select the constructor's random default, a new DeviceId per launch.
export function createGatewayFactory(host: GatewayHost): GatewayFactory {
  return async (serverUrl, stores) => {
    const id: unknown = await host.installId();
    if (!isInstallId(id)) throw new Error("The install id is not available.");
    return new JellyfinGateway(serverUrl, host.crypto, host.transport, id, stores?.confirmations, stores?.streamingLimits, stores?.deviceCapabilities);
  };
}

// What this device can play, as the player engine's initialize answers it (./device-capabilities.ts).
export type CapabilityProbe = () => Promise<PlayerCapabilities>;

// How long a gateway waits for the device probe before it counts the probe as "cannot tell".
export const PROBE_LIMIT_MS = 10_000;

// The probe's answer, or a rejection once limitMs has passed; the timer is cleared either way.
async function within<T>(answer: Promise<T>, limitMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("The device probe did not answer in time.")), limitMs);
  });
  try {
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
}

// The factory the app composes (T8-07 items 2, 5 and 9): each gateway it builds probes the device once and hands the
// answer to the core's source decision. It throws at composition without a probe, so the app can never fall back to
// the core's "full" default; a probe that rejects, does not answer within limitMs, or answers anything but a
// capability list is "cannot tell". The app's source wins over a caller's deviceCapabilities store.
export function createAppGatewayFactory(host: GatewayHost, probe: CapabilityProbe, limitMs: number = PROBE_LIMIT_MS): GatewayFactory {
  if (typeof probe !== "function") throw new Error("No device capability source.");
  const build = createGatewayFactory(host);
  return async (serverUrl, stores) => {
    let answer: PlayerCapabilities;
    try {
      answer = readCapabilities(await within(Promise.resolve().then(probe), limitMs));
    } catch {
      answer = { probe: "failed" };
    }
    const deviceCapabilities: DeviceCapabilitySource = { get: () => answer };
    return build(serverUrl, { ...stores, deviceCapabilities });
  };
}
