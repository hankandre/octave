// The app's Crypto (T3-02): SHA-256 and version 4 UUIDs from expo-crypto, behind the core's Crypto port. Nothing is put
// on a global: the core takes hashing and random ids only through this port (packages/core/host-globals.d.ts).
import type { Crypto } from "@octave/core/src/ports/crypto";
import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, randomUUID } from "expo-crypto";

export const hostCrypto: Crypto = {
  sha256Hex: (text) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text, { encoding: CryptoEncoding.HEX }),
  randomId: () => randomUUID(),
};
