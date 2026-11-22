// The e2e build's root (T3-02): runs the core's conformance suites with the app's host adapters once, and writes the
// OCTAVE_E2E lines scripts/tv-e2e.mjs judges; then the wire tests of pnpm tv:wire (T3-05), which write OCTAVE_WIRE
// lines. It reaches only an e2e bundle (apps/tv/e2e-gate.js).
import { useEffect } from "react";
import { View } from "react-native";
import { hostClock } from "../host/clock";
import { hostCrypto } from "../host/crypto";
import { urlIsExpoBuiltin } from "../host/url";
import { runConformance } from "./conformance-run";
import { runWire } from "./wire/run-wire";

// Hermes defines HermesInternal as an object; other engines leave it undefined.
const hermes = (globalThis as { HermesInternal?: unknown }).HermesInternal;
const engine = typeof hermes === "object" && hermes !== null ? "hermes" : "other";

let started = false;

export default function E2eRoot(props: Record<string, unknown>) {
  useEffect(() => {
    if (started) return;
    started = true;
    const log = (line: string) => console.info(line);
    void runConformance({ clock: hostClock, crypto: hostCrypto, urlSource: urlIsExpoBuiltin() ? "expo-builtin" : "other", engine }, log).then(() =>
      runWire({ crypto: hostCrypto, props }, log),
    );
  }, [props]);
  return <View />;
}
