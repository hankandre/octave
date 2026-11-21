// The shared DeviceId conformance suite (T3-02). It derives every vector of
// device-ids.json with deriveDeviceId and the host's Crypto, so Node (with the
// reference WebCrypto adapter) and the TV (with expo-crypto, under Hermes) must
// derive the same value. Like the URL suite it imports no test runner and no
// Node module, never throws, and reports vector names and fixed words only:
// never a derived value or an error message.
import deviceIds from "../../tests/fixtures/device-ids.json";
import { deriveDeviceId } from "../jellyfin/device-id";
import type { Crypto } from "../ports/crypto";

export interface DeviceIdConformanceFailure {
  // The vector's `name`. Fixture text only.
  vector: string;
  actual: "different" | "threw";
}

export interface DeviceIdConformanceReport {
  total: number;
  passed: number;
  failures: DeviceIdConformanceFailure[];
}

interface DeviceIdVector {
  name: string;
  installId: string;
  serverId: string;
  username: string;
  deviceId: string;
}

const vectors = (deviceIds as unknown as { vectors: DeviceIdVector[] }).vectors;

async function check(crypto: Crypto, vector: DeviceIdVector): Promise<DeviceIdConformanceFailure["actual"] | undefined> {
  let derived: string;
  try {
    derived = await deriveDeviceId(crypto, vector.installId, vector.serverId, vector.username);
  } catch {
    return "threw";
  }
  return derived === vector.deviceId ? undefined : "different";
}

export async function runDeviceIdConformance(crypto: Crypto): Promise<DeviceIdConformanceReport> {
  const failures: DeviceIdConformanceFailure[] = [];
  for (const vector of vectors) {
    const actual = await check(crypto, vector);
    if (actual !== undefined) failures.push({ vector: vector.name, actual });
  }
  return { total: vectors.length, passed: vectors.length - failures.length, failures };
}
