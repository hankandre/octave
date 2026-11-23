// @vitest-environment node
// T8-07 items 1 (the module's sources), 2, 3, 5 and 9 (docs/specs/T8-07.md, "The app" and Test plan 7): the app hands
// the device probe's answer to the core's source decision, and cannot be composed without one.
//
// The contract frozen here:
// - apps/tv/src/host/gateway.ts exports createAppGatewayFactory(host, probe), where probe is
//   () => Promise<PlayerCapabilities>. It throws new Error("No device capability source.") synchronously when probe is
//   not a function. Each gateway it builds awaits the probe once, passes the answer through readCapabilities (a
//   rejection is { probe: "failed" }), and builds the gateway with createGatewayFactory(host) and
//   { ...stores, deviceCapabilities: { get: () => answer } }, so the app's source wins over a caller's store.
//   createGatewayFactory is unchanged (scripts/tv-install-id.test.ts, T4-09, still builds with it).
// - apps/tv/src/host/device-capabilities.ts exports createCapabilityProbe(engine), engine: () => { initialize() }, which
//   answers engine().initialize() and { probe: "failed" } when engine() throws or initialize rejects. Node-loadable.
// - apps/tv/src/host/host-gateway.ts builds hostGateway with createAppGatewayFactory and createCapabilityProbe.
//
// The modules this task creates are loaded at run time from a path built here, so `pnpm typecheck` does not depend on
// them existing (as scripts/tv-install-id.test.ts does).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import vectors from "../packages/core/tests/fixtures/device-capability-probes.json";
import { webCrypto } from "../packages/core/src/adapters/web-crypto";
import type { LibraryItem } from "../packages/core/src/domain/catalog";
import type { PlayerCapabilities } from "../packages/core/src/domain/player-engine";
import type { PlaybackPlan } from "../packages/core/src/domain/playback";
import type { JellyfinGateway } from "../packages/core/src/jellyfin/gateway";
import { QueueTransport, queryValue, recorded, VERSIONS, type Post } from "../packages/core/src/jellyfin/device-test-support";
import type { PlaybackInfoResponse } from "../packages/core/src/jellyfin/types";
import type { Transport } from "../packages/core/src/ports/transport";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = "http://127.0.0.1:8096";
const INSTALL_ID = "7e1d9a4c-3b2f-4a6e-8d5c-1f0e9b8a7c6d";
const NO_SOURCE = "No device capability source.";

type Probe = () => Promise<unknown>;
type Host = { crypto: typeof webCrypto; transport: Transport; installId: () => Promise<string> };
type Stores = Record<string, unknown>;
type GatewayModule = {
  createAppGatewayFactory: (host: Host, probe: unknown) => (serverUrl: string, stores?: Stores) => Promise<JellyfinGateway>;
};
type ProbeModule = {
  createCapabilityProbe: (engine: () => { initialize(): Promise<unknown> }) => () => Promise<PlayerCapabilities>;
};

async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(join(repo, path)).href)) as T;
}

const loadFactory = async () => (await load<GatewayModule>("apps/tv/src/host/gateway.ts")).createAppGatewayFactory;
const loadProbe = async () => (await load<ProbeModule>("apps/tv/src/host/device-capabilities.ts")).createCapabilityProbe;

type Case = { name: string; capabilities: PlayerCapabilities };
const cases = vectors.cases as unknown as Case[];
const EMULATOR_LIKE = cases.find((entry) => entry.name.includes("emulator-like"))!.capabilities;

// The emulator-like list without its AVC decoders: a device with no H.264 decoder.
const WITHOUT_H264: PlayerCapabilities =
  EMULATOR_LIKE.probe === "complete" ? { ...EMULATOR_LIKE, videoDecoders: EMULATOR_LIKE.videoDecoders.filter((decoder) => decoder.codec !== "h264") } : EMULATOR_LIKE;

// The emulator-like list without its HEVC decoder. It still decodes H.264, the codec a conversion is encoded into.
const WITHOUT_HEVC: PlayerCapabilities =
  EMULATOR_LIKE.probe === "complete" ? { ...EMULATOR_LIKE, videoDecoders: EMULATOR_LIKE.videoDecoders.filter((decoder) => decoder.codec !== "hevc") } : EMULATOR_LIKE;

const ITEM: LibraryItem = { id: "item-h264", name: "Fixture", type: "Movie", resumePositionTicks: 0, played: false };
const HEVC_ITEM: LibraryItem = { ...ITEM, id: "item-hevc" };

function host(answers: PlaybackInfoResponse[]) {
  const transport = new QueueTransport(answers);
  return { transport, host: { crypto: webCrypto, transport, installId: async () => INSTALL_ID } };
}

function counting(answer: () => Promise<unknown>) {
  const probe = { calls: 0, run: (async () => {
    probe.calls += 1;
    return answer();
  }) as Probe };
  return probe;
}

const h264Answers = (version: string) => [recorded(version, "conversion-h264"), recorded(version, "device-conversion-h264")];

// Builds a gateway with the app's factory and the given probe, signs in, and asks for one plan of the H.264 item.
async function negotiateApp(probe: Probe, version: string, stores?: Stores) {
  const createAppGatewayFactory = await loadFactory();
  const { transport, host: made } = host(h264Answers(version));
  const gateway = await createAppGatewayFactory(made, probe)(SERVER, stores);
  await gateway.login("tester", "password");
  const result = await gateway.createPlaybackPlan(ITEM, 0).catch((error: unknown) => error);
  return { transport, result };
}

function planOf(result: unknown): PlaybackPlan {
  if (result instanceof Error) throw result;
  return result as PlaybackPlan;
}

function expectFirst(first: Post) {
  expect(first.data).toMatchObject({ EnableDirectPlay: true, AllowVideoStreamCopy: true, AllowAudioStreamCopy: true });
  expect(queryValue(first, "EnableDirectPlay")).toBe("true");
  expect(queryValue(first, "AllowVideoStreamCopy")).toBe("true");
}

// The one forced-conversion request: direct play and video copy off, in the body and in the query.
function expectForced(forced: Post) {
  expect(forced.data).toMatchObject({ EnableDirectPlay: false, AllowVideoStreamCopy: false });
  expect(queryValue(forced, "EnableDirectPlay")).toBe("false");
  expect(queryValue(forced, "AllowVideoStreamCopy")).toBe("false");
}

// ---- item 2 ----

describe.each(VERSIONS)("T8-07 item 2: a source the device decodes direct plays with one request (Jellyfin %s)", (version) => {
  it("T8-07 item 2: a probe answering the emulator-like list gives one PlaybackInfo and a static plan for the H.264 answer", async () => {
    const { transport, result } = await negotiateApp(async () => EMULATOR_LIKE, version);
    expect(transport.posts).toHaveLength(1);
    expectFirst(transport.posts[0]);
    const plan = planOf(result);
    expect(plan.delivery).toBe("static");
    expect(plan.playMethod).toBe("DirectPlay");
  });

  it("T8-07 item 2: the probe runs once per gateway built, not once per negotiation", async () => {
    const createAppGatewayFactory = await loadFactory();
    const probe = counting(async () => EMULATOR_LIKE);
    const { host: made } = host([recorded(version, "conversion-h264")]);
    const factory = createAppGatewayFactory(made, probe.run);
    expect(probe.calls).toBe(0);
    const gateway = await factory(SERVER);
    await gateway.login("tester", "password");
    planOf(await gateway.createPlaybackPlan(ITEM, 0).catch((error: unknown) => error));
    planOf(await gateway.createPlaybackPlan(ITEM, 0).catch((error: unknown) => error));
    expect(probe.calls).toBe(1);
    await factory(SERVER);
    expect(probe.calls).toBe(2);
  });

  it("T8-07 item 2: the gateway reads the answer of its own probe call, not a later one", async () => {
    const createAppGatewayFactory = await loadFactory();
    let answer: PlayerCapabilities = EMULATOR_LIKE;
    const { transport, host: made } = host(h264Answers(version));
    const gateway = await createAppGatewayFactory(made, async () => answer)(SERVER);
    answer = WITHOUT_H264;
    await gateway.login("tester", "password");
    planOf(await gateway.createPlaybackPlan(ITEM, 0).catch((error: unknown) => error));
    expect(transport.posts).toHaveLength(1);
  });
});

// ---- item 3 ----

describe.each(VERSIONS)("T8-07 item 3: a source whose video codec has no decoder sends the one forced request (Jellyfin %s)", (version) => {
  // The HEVC sample on a list without hevc: the forced answer is encoded into H.264, which the list decodes. A list
  // without h264 cannot decode that answer (T8-23).
  it("T8-07 item 3: with a probe lacking hevc, two posts, the second forced in body and query, and an hls plan the client asked for", async () => {
    const createAppGatewayFactory = await loadFactory();
    const { transport, host: made } = host([recorded(version, "conversion-hevc-hdr10"), recorded(version, "device-conversion-hevc-hdr10")]);
    const gateway = await createAppGatewayFactory(made, async () => WITHOUT_HEVC)(SERVER);
    await gateway.login("tester", "password");
    const result = await gateway.createPlaybackPlan(HEVC_ITEM, 0).catch((error: unknown) => error);
    expect(transport.posts).toHaveLength(2);
    const [first, forced] = transport.posts;
    expectFirst(first);
    expectForced(forced);
    const plan = planOf(result);
    expect(plan.delivery).toBe("hls");
    if (plan.delivery !== "hls") return;
    expect(plan.clientConversionReason).toBe("DeviceCannotPlay");
  });
});

// ---- item 5 ----

describe("T8-07 item 5: a probe failure is cannot tell, never can play", () => {
  const FAILING: [string, Probe][] = [
    ["a probe that rejects", async () => Promise.reject(new Error("probe broke"))],
    ["a probe that answers \"full\"", async () => "full"],
    ["a probe that answers {}", async () => ({})],
    ["a probe that answers null", async () => null],
    ["a probe that answers { probe: \"failed\" }", async () => ({ probe: "failed" })],
    ["a probe that answers a list whose arrays are missing", async () => ({ probe: "complete", videoDecoders: [{ codec: "h264", hardware: true }] })],
  ];

  for (const version of VERSIONS) {
    it.each(FAILING)(`T8-07 item 5: %s makes the H.264 negotiation to Jellyfin ${version} send the forced request`, async (_name, probe) => {
      const { transport } = await negotiateApp(probe, version);
      expect(transport.posts).toHaveLength(2);
      expectFirst(transport.posts[0]);
      expectForced(transport.posts[1]);
    });
  }

  it("T8-07 item 5: createCapabilityProbe answers the engine's initialize", async () => {
    const createCapabilityProbe = await loadProbe();
    const probe = createCapabilityProbe(() => ({ initialize: async () => EMULATOR_LIKE }));
    expect(await probe()).toEqual(EMULATOR_LIKE);
  });

  it("T8-07 item 5: createCapabilityProbe is cannot tell when the engine cannot be built (the module does not load)", async () => {
    const createCapabilityProbe = await loadProbe();
    const probe = createCapabilityProbe(() => {
      throw new Error("The player module is not available on this platform.");
    });
    expect(await probe()).toEqual({ probe: "failed" });
  });

  it("T8-07 item 5: createCapabilityProbe is cannot tell when initialize rejects", async () => {
    const createCapabilityProbe = await loadProbe();
    const probe = createCapabilityProbe(() => ({ initialize: async () => Promise.reject(new Error("unknown")) }));
    expect(await probe()).toEqual({ probe: "failed" });
  });

  it("T8-07 item 5: createCapabilityProbe asks the engine afresh on every call", async () => {
    const createCapabilityProbe = await loadProbe();
    let built = 0;
    const probe = createCapabilityProbe(() => {
      built += 1;
      return { initialize: async () => EMULATOR_LIKE };
    });
    await probe();
    await probe();
    expect(built).toBe(2);
  });
});

// ---- item 9 ----

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const tvSrc = join(repo, "apps", "tv", "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const codeOf = (path: string) => stripComments(readFileSync(join(repo, path), "utf8"));

function sources(): { path: string; code: string }[] {
  return walk(tvSrc)
    .filter((path) => CODE.test(path) && !TEST_FILE.test(path))
    .map((path) => {
      const rel = relative(repo, path).split("\\").join("/");
      return { path: rel, code: codeOf(rel) };
    });
}

const inE2e = (path: string) => path.startsWith("apps/tv/src/e2e/");

describe("T8-07 item 9: the app cannot be composed without a device capability source", () => {
  it.each([
    ["no probe", undefined],
    ["null", null],
    ["an object", {}],
    ["the word full", "full"],
    ["a capability source object", { get: () => "full" }],
  ] as const)("T8-07 item 9: createAppGatewayFactory throws at composition with %s", async (_name, probe) => {
    const createAppGatewayFactory = await loadFactory();
    const { host: made } = host([recorded("12.4.0", "conversion-h264")]);
    expect(() => createAppGatewayFactory(made, probe)).toThrow(NO_SOURCE);
  });

  it("T8-07 item 9: a caller's deviceCapabilities store stating full does not win over the app's probe", async () => {
    const { transport } = await negotiateApp(async () => WITHOUT_H264, "12.4.0", { deviceCapabilities: { get: () => "full" } });
    expect(transport.posts).toHaveLength(2);
    expectForced(transport.posts[1]);
  });

  it("T8-07 item 9: the scan's comment stripper keeps code and drops comments (harness check)", () => {
    expect(stripComments("// createGatewayFactory(\nconst a = 1; /* deviceCapabilities */")).not.toMatch(/createGatewayFactory|deviceCapabilities/);
    expect(stripComments("const url = \"http://x\"; createGatewayFactory(host)")).toContain("createGatewayFactory(host)");
  });

  it("T8-07 item 9: outside e2e/, only host/gateway.ts calls createGatewayFactory or names deviceCapabilities", () => {
    const outside = sources().filter((file) => !inE2e(file.path));
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.filter((file) => /\bcreateGatewayFactory\s*\(/.test(file.code)).map((file) => file.path)).toEqual(["apps/tv/src/host/gateway.ts"]);
    expect(outside.filter((file) => /\bdeviceCapabilities\b/.test(file.code)).map((file) => file.path)).toEqual(["apps/tv/src/host/gateway.ts"]);
  });

  it("T8-07 item 9: hostGateway is built by createAppGatewayFactory with the engine's probe", () => {
    const wired = codeOf("apps/tv/src/host/host-gateway.ts");
    expect(wired).toMatch(/\bcreateAppGatewayFactory\s*\(/);
    expect(wired).toMatch(/\bcreateCapabilityProbe\s*\(/);
    expect(wired).not.toMatch(/\bcreateGatewayFactory\b/);
    expect(existsSync(join(repo, "apps/tv/src/host/device-capabilities.ts"))).toBe(true);
  });

  it("T8-07 item 9: in e2e/, only run-wire.ts names deviceCapabilities, building the stated-full gateway beside the app's", () => {
    const e2e = sources().filter((file) => inE2e(file.path));
    expect(e2e.filter((file) => /\bdeviceCapabilities\b/.test(file.code)).map((file) => file.path)).toEqual(["apps/tv/src/e2e/wire/run-wire.ts"]);
    const runWire = codeOf("apps/tv/src/e2e/wire/run-wire.ts");
    expect(runWire).toMatch(/\bcreateAppGatewayFactory\s*\(/);
    expect(runWire).toMatch(/\bgatewayStatingFull\b/);
  });

  it("T8-07 item 9: only the three T8-02 player wire tests ask for the stated-full gateway (D3)", () => {
    const wire = sources().filter((file) => file.path.startsWith("apps/tv/src/e2e/wire/"));
    const asking = wire.filter((file) => /\bstatingFull\s*:\s*true\b/.test(file.code)).map((file) => file.path).sort();
    expect(asking).toEqual([
      "apps/tv/src/e2e/wire/player-original-file.ts",
      "apps/tv/src/e2e/wire/player-redirect.ts",
      "apps/tv/src/e2e/wire/player-samples.ts",
    ]);
    expect(codeOf("apps/tv/src/e2e/wire/player-capabilities.ts")).not.toMatch(/statingFull/i);
  });
});

// ---- item 1: the module's sources ----

describe("T8-07 item 1: the Media3 engine answers the device probe", () => {
  const MAIN = "modules/player/android/src/main/java/dev/octave/player";
  const kotlin = (path: string) => stripComments(readFileSync(join(repo, MAIN, path), "utf8"));

  it("T8-07 item 1: capabilities() runs the probe instead of answering Failed", () => {
    const engine = kotlin("media3/Media3Engine.kt");
    expect(engine).not.toMatch(/override fun capabilities\(\)\s*(?::\s*Capabilities\s*)?=\s*Capabilities\s*\.\s*Failed/);
    expect(engine).toMatch(/\bCapabilityProbe\b/);
    expect(engine).toMatch(/\bDevicePlatformReader\b/);
  });

  it("T8-07 item 1: the Android half reads Media3's decoder lists and audio capabilities, and nothing in the probe logs", () => {
    for (const path of ["media3/DevicePlatformReader.kt", "media3/PlatformNames.kt", "engine/CapabilityMap.kt", "engine/CapabilityProbe.kt"]) {
      expect(existsSync(join(repo, MAIN, path)), path).toBe(true);
    }
    const reader = kotlin("media3/DevicePlatformReader.kt");
    expect(reader).toMatch(/MediaCodecUtil\s*\.\s*getDecoderInfos\s*\(/);
    expect(reader).toMatch(/\bAudioCapabilities\b/);
    for (const path of ["media3/DevicePlatformReader.kt", "media3/PlatformNames.kt", "engine/CapabilityMap.kt", "engine/CapabilityProbe.kt"]) {
      expect(kotlin(path), path).not.toMatch(/\bLog\s*\.\s*[a-z]+\s*\(|println\s*\(/);
    }
  });
});
