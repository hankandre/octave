// The wired install id source and gateway factory (T4-09, T8-07). This file imports ./crypto (expo-crypto) and the
// native loaders, so it runs only on the device; the factories it wires are tested under Node from ./install-id.ts,
// ./gateway.ts and ./device-capabilities.ts. Screens call hostGateway(serverUrl, stores) and construct no gateway
// themselves; each gateway probes the device's decoders through the player module.
import { hostCrypto } from "./crypto";
import { createCapabilityProbe } from "./device-capabilities";
import { createAppGatewayFactory, type GatewayFactory } from "./gateway";
import { createInstallIdSource, type InstallIdSource } from "./install-id";
import { loadInstallIdModule } from "./install-id-module";
import { createPlayerEngine } from "./player-engine";
import { loadPlayerModule } from "./player-module";
import { loadSessionModule } from "./session-module";
import { createSessionTransport } from "./transport";

export const hostInstallId: InstallIdSource = createInstallIdSource(loadInstallIdModule, hostCrypto);

let factory: GatewayFactory | undefined;

// The host is built on first use, so importing this file loads no native module.
export const hostGateway: GatewayFactory = (serverUrl, stores) => {
  factory ??= createAppGatewayFactory(
    { crypto: hostCrypto, transport: createSessionTransport(loadSessionModule()), installId: hostInstallId },
    createCapabilityProbe(() => createPlayerEngine(loadPlayerModule())),
  );
  return factory(serverUrl, stores);
};
