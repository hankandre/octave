// What run-wire.ts hands each wire test, and the helpers the tests share (T3-05).
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import type { ReactElement } from "react";
import type { Crypto } from "@octave/core/src/ports/crypto";
import type { Transport } from "@octave/core/src/ports/transport";
import type { SeamRecorder } from "./seam-recorder";
import list from "./wire-tests.json";

export type WireList = typeof list;

export interface WireContext {
  // The pair's base URL on the device: a loopback port the host reverses to the pair's recorder.
  readonly base: string;
  readonly list: WireList;
  readonly crypto: Crypto;
  readonly transport: Transport;
  readonly seam: SeamRecorder;
  // A gateway for `base` over this pair's transport, from the app's factory (T4-09, T8-07): it sends the stored install
  // id's DeviceId and hands the device probe's answer to the core's source decision.
  readonly gateway: (base: string) => Promise<JellyfinGateway>;
  // The same gateway with a host that states no device limit, for the T8-02 player tests only (T8-07 D3): they test
  // the engine behind such a host, and the engine's own refusal is the second guard.
  readonly gatewayStatingFull: (base: string) => Promise<JellyfinGateway>;
  // Draws an element over the root's player view, or nothing; resolves once React has committed it (T3-11's artwork
  // tests mount and unmount native views with it).
  readonly show: (element: ReactElement | null) => Promise<void>;
  // Asks the runner to send the remote's key (T8-04): one app line, which the runner answers with one adb key event.
  readonly press: (key: WireKey) => void;
  // Asks the runner to approve a Quick Connect code on this pair's server, as a signed-in phone would (T4-03).
  readonly approve: (code: string) => void;
  // Asks the runner to read whether the app's window holds the keep-screen-on flag, in the state the app is in.
  readonly readWindow: (state: "paused" | "playing") => void;
}

// The closed list of scripts/tv-wire-keys.mjs, which fails the run on any other name.
export type WireKey = "DPAD_UP" | "DPAD_DOWN" | "DPAD_LEFT" | "DPAD_RIGHT" | "DPAD_CENTER" | "MEDIA_PLAY_PAUSE" | "BACK";

// A test's outcome: the words of its result line, or unreachable when its first call found no listener.
export type WireOutcome = { readonly words: string } | { readonly unreachable: true };

export const UNREACHABLE: WireOutcome = { unreachable: true };

// The DeviceId the gateway sends on its probe (packages/core/src/jellyfin/gateway.ts, UNAUTHENTICATED_DEVICE_ID).
export const PROBE_DEVICE_ID = "octave-unauthenticated";

// A fixed word for an error: a transport code, a gateway failure's kind, or "error". Never a message.
export function codeOf(error: unknown): string {
  const fields = error as { code?: unknown; kind?: unknown } | null;
  if (typeof fields?.code === "string" && /^[a-z-]+$/.test(fields.code)) return fields.code;
  if (typeof fields?.kind === "string" && /^[a-z-]+$/.test(fields.kind)) return fields.kind;
  return "error";
}

// "ok", or the error's word. The result or the error goes to the seam's scan.
export async function outcomeOf(work: Promise<unknown>, seam: Pick<SeamRecorder, "add">): Promise<string> {
  try {
    seam.add(await work);
    return "ok";
  } catch (error) {
    seam.add(error);
    return codeOf(error);
  }
}

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
