// Types for tv-wire-proxy.mjs.
import type { CaptureRecord } from "./tv-wire-judge.mjs";
export function describeAuthorization(value: unknown): { authorization: boolean; scheme: string | null; token: boolean };
export type PlaybackInfoFlags = Record<"EnableDirectPlay" | "EnableDirectStream" | "EnableTranscoding" | "AllowVideoStreamCopy" | "AllowAudioStreamCopy" | "AutoOpenLiveStream", boolean | null>;
export function playbackInfoFacts(body: string, rawUrl: string): { body: PlaybackInfoFlags; query: PlaybackInfoFlags; profile: string | null };
export function startRecorder(options: {
  upstream: { port: number };
  secrets: Set<string>;
  swap?: { from: { user: string; password: string }; to: { user: string; password: string } };
}): Promise<{ port: number; records: CaptureRecord[]; close: () => Promise<void> }>;
export function startProxyListener(): Promise<{ port: number; seen: { method: string; target: string; host: string }[]; close: () => Promise<void> }>;
export function proxyRequestsNamingTargets<T extends { host: string; target: string }>(seen: T[], ports: number[]): T[];
export function serverAnswers(url: string): Promise<boolean>;
