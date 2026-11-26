// The e2e build's root (T3-02): first the install-id lines of pnpm tv:e2e's install-id stage (T4-09, OCTAVE_INSTALL);
// then the core's conformance suites with the app's host adapters, once, writing the OCTAVE_E2E lines
// scripts/tv-e2e.mjs judges; then the wire tests of pnpm tv:wire (T3-05), which write OCTAVE_WIRE
// lines. It reaches only an e2e bundle (apps/tv/e2e-gate.js). It renders the player view full screen, so the player's
// wire tests (T8-02) have a surface to draw on, and over it whatever a wire test shows (T3-11's artwork views). Once the
// wire run is done it shows the player screen's fixtures (T8-03 D15), then the Quick Connect step's (T4-03 D13) and
// the server step's (T4-02 D14) for the captures.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { hostClock } from "../host/clock";
import { hostCrypto } from "../host/crypto";
import { hostInstallId } from "../host/host-gateway";
import { loadPlayerView } from "../host/player-view";
import { urlIsExpoBuiltin } from "../host/url";
import { runConformance } from "./conformance-run";
import { runInstallId } from "./install-id-run";
import { showPlayerFixtures } from "./wire/player-fixture-screen";
import { showQuickConnectFixtures } from "./wire/quick-connect-fixture-screen";
import { runWire } from "./wire/run-wire";
import { showSignInFixtures } from "./wire/sign-in-fixture-screen";
import { wait } from "./wire/wire-context";

// Hermes defines HermesInternal as an object; other engines leave it undefined.
const hermes = (globalThis as { HermesInternal?: unknown }).HermesInternal;
const engine = typeof hermes === "object" && hermes !== null ? "hermes" : "other";

let started = false;

// How long the last player fixture stays before the sign-in fixtures replace it.
const PLAYER_FAILURE_HOLD_MS = 30_000;

type Shown = { element: ReactElement | null; committed: () => void };

export default function E2eRoot(props: Record<string, unknown>) {
  const PlayerView = useMemo(loadPlayerView, []);
  const [shown, setShown] = useState<Shown>({ element: null, committed: () => undefined });
  // A wire test's show() resolves once React has committed what it asked for.
  useEffect(() => shown.committed(), [shown]);
  const show = useCallback((element: ReactElement | null) => new Promise<void>((resolve) => setShown({ element, committed: resolve })), []);
  useEffect(() => {
    if (started) return;
    started = true;
    const log = (line: string) => console.info(line);
    // The install-id run comes first, whatever its result: the stage waits only for its done line.
    void runInstallId({ crypto: hostCrypto, installId: hostInstallId }, log)
      .then(() => runConformance({ clock: hostClock, crypto: hostCrypto, urlSource: urlIsExpoBuiltin() ? "expo-builtin" : "other", engine }, log))
      .then(() => runWire({ crypto: hostCrypto, props, show }, log))
      .then(() => showPlayerFixtures(show))
      .then(() => wait(PLAYER_FAILURE_HOLD_MS))
      .then(() => showQuickConnectFixtures(show, log))
      .then(() => showSignInFixtures(show, log));
  }, [props, show]);
  return (
    <>
      <PlayerView style={StyleSheet.absoluteFill} />
      {shown.element === null ? null : <View style={StyleSheet.absoluteFill}>{shown.element}</View>}
    </>
  );
}
