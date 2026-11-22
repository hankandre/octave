// The one place under apps/tv that builds a JellyfinGateway (T4-09). Every gateway takes the stored install id, so the
// DeviceId for a server and user is the same after a relaunch; ESLint fails a construction or a value import of the
// class anywhere else. The only value import is the core's gateway, so Node can load this file; the wired factory is
// hostGateway in ./host-gateway.ts.
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
