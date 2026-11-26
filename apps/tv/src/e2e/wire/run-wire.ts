// The app's side of pnpm tv:wire (T3-05): after the conformance run, walk every (test, target) pair of
// wire-tests.json, run the pair's test against its device port, and write one OCTAVE_WIRE line per pair, then
// OCTAVE_WIRE done. The app cannot know which pairs the host selected, so it runs them all; a pair whose port has no
// listener is reported unreachable (under pnpm tv:e2e nothing is reversed, so every pair is). Lines hold fixed words
// and counts only.
import type { Crypto } from "@octave/core/src/ports/crypto";
import type { ReactElement } from "react";
import { createCapabilityProbe } from "../../host/device-capabilities";
import { createAppGatewayFactory, createGatewayFactory } from "../../host/gateway";
import { hostInstallId } from "../../host/host-gateway";
import { createPlayerEngine } from "../../host/player-engine";
import { loadPlayerModule } from "../../host/player-module";
import * as playerCapabilities from "./player-capabilities";
import { loadSessionModule } from "../../host/session-module";
import { createSessionTransport } from "../../host/transport";
import * as artworkCanary from "./artwork-canary";
import * as artworkHeaderAndCache from "./artwork-header-and-cache";
import * as playerOriginalFile from "./player-original-file";
import * as playerRedirect from "./player-redirect";
import * as playerSamples from "./player-samples";
import * as playerTransport from "./player-transport";
import * as playerViewing from "./player-viewing";
import { SeamRecorder } from "./seam-recorder";
import * as canary from "./transport-canary";
import * as errors from "./transport-errors";
import * as privateLan from "./transport-private-lan-and-proxy";
import * as probeThenSignedIn from "./transport-probe-then-signed-in";
import * as redirect from "./transport-redirect";
import * as signInQuickConnect from "./sign-in-quick-connect";
import type { WireContext, WireOutcome } from "./wire-context";
import list from "./wire-tests.json";

const TESTS: Record<string, (context: WireContext) => Promise<WireOutcome>> = {
  "transport-probe-then-signed-in": probeThenSignedIn.run,
  "transport-redirect": redirect.run,
  "transport-canary": canary.run,
  "transport-errors": errors.run,
  "transport-private-lan-and-proxy": privateLan.run,
  "player-original-file": playerOriginalFile.run,
  "player-samples": playerSamples.run,
  "player-redirect": playerRedirect.run,
  "player-capabilities": playerCapabilities.run,
  "artwork-header-and-cache": artworkHeaderAndCache.run,
  "artwork-canary": artworkCanary.run,
  "player-viewing": playerViewing.run,
  "player-transport": playerTransport.run,
  "sign-in-quick-connect": signInQuickConnect.run,
};

// The app's probe, as host-gateway.ts wires it: the player engine's initialize.
const probe = createCapabilityProbe(() => createPlayerEngine(loadPlayerModule()));

export async function runWire(host: { crypto: Crypto; props: unknown; show: (element: ReactElement | null) => Promise<void> }, log: (line: string) => void): Promise<void> {
  let index = 0;
  // The running count of the keys asked for; the runner holds each key line to it.
  let presses = 0;
  const press: WireContext["press"] = (key) => {
    presses += 1;
    log(`OCTAVE_WIRE key ${key} ${presses}`);
  };
  const readWindow: WireContext["readWindow"] = (state) => log(`OCTAVE_WIRE window ${state}`);
  const approve: WireContext["approve"] = (code) => log(`OCTAVE_WIRE approve ${code}`);
  for (const test of list.tests) {
    for (const target of test.targets) {
      const base = `http://127.0.0.1:${list.basePort + index}`;
      index += 1;
      const tag = `test=${test.id} target=${target}`;
      const run = TESTS[test.id];
      let outcome: WireOutcome;
      try {
        const seam = new SeamRecorder(loadSessionModule());
        seam.add(host.props);
        const transport = createSessionTransport(seam.native);
        const made = { crypto: host.crypto, transport, installId: hostInstallId };
        const factory = createAppGatewayFactory(made, probe);
        // Only the three T8-02 player tests ask for this one (T8-07 D3).
        const statingFull = createGatewayFactory(made);
        const context: WireContext = {
          base,
          list,
          crypto: host.crypto,
          transport,
          seam,
          gateway: (url) => factory(url),
          show: host.show,
          press,
          readWindow,
          approve,
          gatewayStatingFull: (url) => statingFull(url, { deviceCapabilities: { get: () => "full" } }),
        };
        outcome = run === undefined ? { words: "outcome=no-device-test" } : await run(context);
      } catch {
        outcome = { words: "outcome=threw" };
      }
      await host.show(null);
      log("unreachable" in outcome ? `OCTAVE_WIRE unreachable ${tag}` : `OCTAVE_WIRE result ${tag} task=${test.task} ${outcome.words}`);
    }
  }
  log("OCTAVE_WIRE done");
}
