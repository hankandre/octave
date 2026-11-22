// The wired install id source and gateway factory (T4-09). This file imports ./crypto (expo-crypto) and the native
// loaders, so it runs only on the device; the factories it wires are tested under Node from ./install-id.ts and
// ./gateway.ts. Screens call hostGateway(serverUrl, stores) and construct no gateway themselves.
import { hostCrypto } from "./crypto";
import { createGatewayFactory, type GatewayFactory } from "./gateway";
import { createInstallIdSource, type InstallIdSource } from "./install-id";
import { loadInstallIdModule } from "./install-id-module";
import { loadSessionModule } from "./session-module";
import { createSessionTransport } from "./transport";

export const hostInstallId: InstallIdSource = createInstallIdSource(loadInstallIdModule, hostCrypto);

let factory: GatewayFactory | undefined;

// The host is built on first use, so importing this file loads no native module.
export const hostGateway: GatewayFactory = (serverUrl, stores) => {
  factory ??= createGatewayFactory({ crypto: hostCrypto, transport: createSessionTransport(loadSessionModule()), installId: hostInstallId });
  return factory(serverUrl, stores);
};
