// What run-wire.ts hands each wire test, and the helpers the tests share (T3-05).
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
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
  // A gateway for `base` over this pair's transport, from the app's one factory (T4-09), so it sends the stored
  // install id's DeviceId.
  readonly gateway: (base: string) => Promise<JellyfinGateway>;
}

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
