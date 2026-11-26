// The shared server-address suite (T4-02 R9). It runs every vector of https-hosts.json through the gateway constructor,
// against the host's own `URL`, so the app can run it on a device and Node can run it in Vitest. Its transport and
// Crypto throw, so no request can leave. It imports no test runner and no Node module, never throws, and reports
// fixture text and fixed words only.
import vectors from "../../tests/fixtures/https-hosts.json";
import { SignInFailure } from "../domain/sign-in-failure";
import { JellyfinGateway } from "../jellyfin/gateway";
import type { Crypto } from "../ports/crypto";
import type { Transport } from "../ports/transport";

export interface ServerAddressConformanceFailure {
  list: "refused" | "accepted" | "invalidPunycode";
  vector: string;
  expected: string;
  // A failure kind, a server URL, "admitted" or "threw". Never an error message.
  actual: string;
}

export interface ServerAddressConformanceReport {
  total: number;
  passed: number;
  failures: ServerAddressConformanceFailure[];
}

const unused = (): never => {
  throw new Error("The server-address suite sends nothing.");
};
const noTransport: Transport = { signIn: async () => unused(), request: async () => unused(), endSession: async () => unused() };
const noCrypto: Crypto = { sha256Hex: async () => unused(), randomId: unused };

// What the gateway made of the address: the URL it would hand over, or its refusal.
function judged(address: string): { serverUrl?: string; refusal?: string } {
  try {
    return { serverUrl: new JellyfinGateway(address, noCrypto, noTransport, "conformance").serverUrl };
  } catch (error) {
    return { refusal: error instanceof SignInFailure ? error.kind : "threw" };
  }
}

export function runServerAddressConformance(): ServerAddressConformanceReport {
  const failures: ServerAddressConformanceFailure[] = [];
  for (const { address, kind } of vectors.refused) {
    const { refusal } = judged(address);
    if (refusal !== kind) failures.push({ list: "refused", vector: address, expected: kind, actual: refusal ?? "admitted" });
  }
  for (const list of ["accepted", "invalidPunycode"] as const) {
    for (const { address, serverUrl } of vectors[list]) {
      const result = judged(address);
      if (result.serverUrl !== serverUrl) {
        failures.push({ list, vector: address, expected: serverUrl, actual: result.serverUrl ?? result.refusal ?? "threw" });
      }
    }
  }
  const total = vectors.refused.length + vectors.accepted.length + vectors.invalidPunycode.length;
  return { total, passed: total - failures.length, failures };
}
