// The e2e build's root (T3-02): first the install-id lines of pnpm tv:e2e's install-id stage (T4-09, OCTAVE_INSTALL);
// then the core's conformance suites with the app's host adapters, once, writing the OCTAVE_E2E lines
// scripts/tv-e2e.mjs judges; then the wire tests of pnpm tv:wire (T3-05), which write OCTAVE_WIRE
// lines. It reaches only an e2e bundle (apps/tv/e2e-gate.js). It renders the player view full screen, so the player's
// wire tests (T8-02) have a surface to draw on.
import { useEffect, useMemo } from "react";
import { StyleSheet } from "react-native";
import { hostClock } from "../host/clock";
import { hostCrypto } from "../host/crypto";
import { hostInstallId } from "../host/host-gateway";
import { loadPlayerView } from "../host/player-view";
import { urlIsExpoBuiltin } from "../host/url";
import { runConformance } from "./conformance-run";
import { runInstallId } from "./install-id-run";
import { runWire } from "./wire/run-wire";

// Hermes defines HermesInternal as an object; other engines leave it undefined.
const hermes = (globalThis as { HermesInternal?: unknown }).HermesInternal;
const engine = typeof hermes === "object" && hermes !== null ? "hermes" : "other";

let started = false;

export default function E2eRoot(props: Record<string, unknown>) {
  const PlayerView = useMemo(loadPlayerView, []);
  useEffect(() => {
    if (started) return;
    started = true;
    const log = (line: string) => console.info(line);
    // The install-id run comes first, whatever its result: the stage waits only for its done line.
    void runInstallId({ crypto: hostCrypto, installId: hostInstallId }, log)
      .then(() => runConformance({ clock: hostClock, crypto: hostCrypto, urlSource: urlIsExpoBuiltin() ? "expo-builtin" : "other", engine }, log))
      .then(() => runWire({ crypto: hostCrypto, props }, log));
  }, [props]);
  return <PlayerView style={StyleSheet.absoluteFill} />;
}
