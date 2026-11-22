import type { LaunchRequest, MediaTrack, PlaybackPlan } from "../domain/playback";
import { ticksToSeconds } from "../domain/playback";
import { hasPlainAsciiAuthority, isPlainAsciiHost } from "../domain/host-class";
import { isCredentialQueryName } from "../jellyfin/credential-query";

// The plan carried a URL Octave will not hand to the player. The message is fixed and names no part of the URL.
export class LaunchRefusedError extends Error {
  constructor() {
    super("Octave will not send this stream address to the player.");
    this.name = "LaunchRefusedError";
  }
}

// Builds the engine's launch request from a negotiated plan (T2-05, T8-22). It copies field by field, so nothing
// else on the plan (item, title, play session, conversion) reaches the engine, and it re-checks every URL it copies
// (rules L0 to L5, S1, S2 in docs/specs/T8-22.md): http or https, plain ASCII host, no user info, fragment,
// credential or header text, one origin, and one of the two shapes. It forwards the parsed URL's href, the
// serialization the core checked. It never builds a URL.
export function launchRequest(plan: PlaybackPlan, sessionId: string): LaunchRequest {
  const tracks = plan.tracks.map(copyTrack);
  const common = {
    sessionId,
    startPositionSeconds: Number.isFinite(plan.startPositionTicks) ? ticksToSeconds(plan.startPositionTicks) : 0,
    tracks,
    ...(plan.defaultAudioStreamIndex !== undefined ? { audioStreamIndex: plan.defaultAudioStreamIndex } : {}),
    ...(plan.defaultSubtitleStreamIndex !== undefined ? { subtitleStreamIndex: plan.defaultSubtitleStreamIndex } : {}),
  };
  if (plan.delivery === "hls") {
    const server = checkedUrl(plan.serverUrl);
    if (server.search !== "" || String(plan.serverUrl).includes("?")) throw new LaunchRefusedError();
    const master = checkedUrl(plan.streamUrl);
    requireOrigin(master, server.origin);
    requireMasterShape(master, server, plan.mediaKind);
    const subtitleTracks = hrefTracks(tracks, server.origin);
    return {
      kind: "hls",
      masterUrl: master.href,
      serverUrl: server.href.replace(/\/+$/, ""),
      mediaKind: plan.mediaKind,
      ...common,
      tracks: subtitleTracks,
    };
  }
  const stream = checkedUrl(plan.streamUrl);
  requireOriginalShape(stream);
  return { kind: "original", url: stream.href, ...common, tracks: hrefTracks(tracks, stream.origin) };
}

function copyTrack(track: MediaTrack): MediaTrack {
  const copy: MediaTrack = { index: track.index, type: track.type, displayTitle: track.displayTitle, external: track.external };
  if (track.codec !== undefined) copy.codec = track.codec;
  if (track.language !== undefined) copy.language = track.language;
  if (track.deliveryUrl !== undefined) copy.deliveryUrl = track.deliveryUrl;
  if (track.title !== undefined) copy.title = track.title;
  if (track.channels !== undefined) copy.channels = track.channels;
  if (track.isDefault !== undefined) copy.isDefault = track.isDefault;
  if (track.isForced !== undefined) copy.isForced = track.isForced;
  if (track.isHearingImpaired !== undefined) copy.isHearingImpaired = track.isHearingImpaired;
  return copy;
}

// Each subtitle URL passes the same checks and is forwarded as its href.
function hrefTracks(tracks: readonly MediaTrack[], origin: string): MediaTrack[] {
  return tracks.map((track) => {
    if (track.deliveryUrl === undefined) return track;
    const url = checkedUrl(track.deliveryUrl);
    requireOrigin(url, origin);
    return { ...track, deliveryUrl: url.href };
  });
}

function requireOrigin(url: URL, origin: string): void {
  if (url.origin !== origin) throw new LaunchRefusedError();
}

// S1: `/Videos/{id}/stream` under any prefix, with exactly one `Static` parameter whose value is `true`.
const ORIGINAL_PATH = /^(?:\/[^/]+)*\/Videos\/[^/]+\/stream$/;
function requireOriginalShape(url: URL): void {
  if (!ORIGINAL_PATH.test(url.pathname)) throw new LaunchRefusedError();
  const statics = [...url.searchParams].filter(([name]) => name.toLowerCase() === "static");
  if (statics.length !== 1 || statics[0][1] !== "true") throw new LaunchRefusedError();
}

// S2: `/videos|audio/{id}/master.m3u8` under the server's base path, of the plan's media kind.
const MASTER_PATH = /^\/(videos|audio)\/[^/]+\/master\.m3u8$/i;
function requireMasterShape(master: URL, server: URL, mediaKind: string): void {
  const basePath = server.pathname.replace(/\/+$/, "");
  if (!master.pathname.startsWith(`${basePath}/`)) throw new LaunchRefusedError();
  const match = MASTER_PATH.exec(master.pathname.slice(basePath.length));
  if (!match || match[1].toLowerCase() !== mediaKind) throw new LaunchRefusedError();
}

// An absolute http or https URL, written and parsed as a plain ASCII host (R1, R2), with no user info, fragment,
// credential query name (bracketed or not), `Token=` or, in its query, `MediaBrowser`. A value that does not parse
// is refused with a fresh error, so the parser's own error (which holds the input) never leaves this module.
function checkedUrl(value: unknown): URL {
  if (typeof value !== "string" || !hasPlainAsciiAuthority(value)) throw new LaunchRefusedError();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LaunchRefusedError();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new LaunchRefusedError();
  if (!isPlainAsciiHost(url.hostname)) throw new LaunchRefusedError();
  if (url.username !== "" || url.password !== "") throw new LaunchRefusedError();
  if (value.includes("#") || url.hash !== "") throw new LaunchRefusedError();
  for (const name of url.searchParams.keys()) {
    if (isCredentialQueryName(name)) throw new LaunchRefusedError();
    if (name.split(/[[\]]/).some(isCredentialQueryName)) throw new LaunchRefusedError();
  }
  requireNoHeaderText(value, url.href);
  return url;
}

// L5: `Token=` anywhere, and `MediaBrowser` in the query, read in the string, its href and the href decoded once.
function requireNoHeaderText(value: string, href: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    throw new LaunchRefusedError();
  }
  for (const text of [value, href, decoded]) {
    const lower = text.toLowerCase();
    if (lower.includes("token=")) throw new LaunchRefusedError();
    const query = lower.includes("?") ? lower.slice(lower.indexOf("?")) : "";
    if (query.includes("mediabrowser")) throw new LaunchRefusedError();
  }
}
