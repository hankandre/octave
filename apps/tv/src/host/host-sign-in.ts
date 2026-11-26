// The wired sign-in services (T4-02 D4, D6). One confirmation store and one remembered-server list per launch, shared
// by every gateway the sign-in step builds. Device-only, like ./host-gateway.ts.
import { MemoryLanHttpConfirmations } from "@octave/core/src/lan-http-confirmations";
import { MemoryRememberedServers } from "@octave/core/src/remembered-servers";
import type { SignInServices } from "../sign-in/sign-in-services";
import { noServerDiscovery } from "./discovery";
import { hostGateway } from "./host-gateway";

export const hostSignInServices: SignInServices = {
  discovery: noServerDiscovery,
  gateways: hostGateway,
  confirmations: new MemoryLanHttpConfirmations(),
  remembered: new MemoryRememberedServers(),
};
