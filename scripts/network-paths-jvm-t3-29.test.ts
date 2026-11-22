// @vitest-environment node
// T3-29 items 3 and 4 (docs/specs/T3-29.md, Test plan): text pins on the Kotlin build-check tests, which run only in
// pnpm tv:native:test (a Gradle build a manifest run cannot start), as scripts/network-paths-jvm.test.ts does for T3-04.
// - Item 3: NetworkPathRules.kt's K4 by type names every class of the dex check's S4 `methods`, the framework subclass
//   android.net.SSLCertificateSocketFactory, and S6's MediaExtractor and MediaMetadataRetriever; the new
//   NetworkPathSocketsTest.kt holds its five tests; RULE_IDS stays K1 to K10.
// - Item 4: NetworkPathsBytecodeTest.kt runs scripts/octave-module-packages.mjs in two new tests.
// Each file is read inside its test, so a missing file fails that case and not the collection.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(repo, "apps", "tv", "native", "app", "src", "test", "java", "dev", "octave", "buildcheck");
const readKotlin = (name: string): string => {
  const path = join(dir, name);
  expect(existsSync(path), `${name} exists`).toBe(true);
  return readFileSync(path, "utf8");
};

type Sink = { id: string; methods?: { classes: string[]; names: string[]; localOverloads?: string[] }[] };

async function sinks(): Promise<Sink[]> {
  const lists = (await import(pathToFileURL(join(repo, "scripts", "tv-apk-dex-lists.mjs")).href)) as { NETWORK_SINKS: Sink[] };
  return lists.NETWORK_SINKS;
}

const slashed = (name: string) => name.replace(/\./g, "/");
const quoted = (text: string, name: string) => text.includes(`"${name}"`);

describe("T3-29 NetworkPathRules: K4 by type", () => {
  it("T3-29 item 3: NetworkPathRules.kt names, slashed and quoted, every class of S4's methods", async () => {
    const rules = readKotlin("NetworkPathRules.kt");
    const s4 = (await sinks()).find((sink) => sink.id === "S4");
    const classes = [...new Set((s4?.methods ?? []).flatMap((m) => m.classes))];
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.map(slashed).filter((name) => !quoted(rules, name))).toEqual([]);
  });

  it("T3-29 item 3: NetworkPathRules.kt names android/net/SSLCertificateSocketFactory, android/media/MediaExtractor and android/media/MediaMetadataRetriever", () => {
    const rules = readKotlin("NetworkPathRules.kt");
    const names = ["android/net/SSLCertificateSocketFactory", "android/media/MediaExtractor", "android/media/MediaMetadataRetriever"];
    expect(names.filter((name) => !quoted(rules, name))).toEqual([]);
  });

  it("T3-29 item 3: the media classes it names are those of S6's entry with localOverloads", async () => {
    const s6 = (await sinks()).find((sink) => sink.id === "S6");
    const media = (s6?.methods ?? []).filter((m) => m.localOverloads !== undefined).flatMap((m) => m.classes);
    expect(media.sort()).toEqual(["android.media.MediaExtractor", "android.media.MediaMetadataRetriever"]);
    const rules = readKotlin("NetworkPathRules.kt");
    expect(media.map(slashed).filter((name) => !quoted(rules, name))).toEqual([]);
  });

  it.each([
    "sockets_channels_and_providers_fail_k4",
    "the_media_readers_fail_k4",
    "only_the_one_client_may_make_a_client_socket",
    "socket_exceptions_and_addresses_pass",
    "every_socket_sink_of_the_dex_check_is_refused_by_k4",
  ])("T3-29 item 3: NetworkPathSocketsTest.kt has the test %s", (name) => {
    const test = readKotlin("NetworkPathSocketsTest.kt");
    expect(test).toMatch(new RegExp(`@Test\\s+fun ${name}\\(\\)`));
  });

  it("T3-29 item 3: RULE_IDS is still K1 to K10", () => {
    const rules = readKotlin("NetworkPathRules.kt");
    const ids = /RULE_IDS = listOf\(([^)]*)\)/.exec(rules)?.[1].match(/K\d+/g) ?? [];
    expect(ids).toEqual(["K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8", "K9", "K10"]);
  });
});

describe("T3-29 NetworkPathsBytecodeTest: rule D8 before R8", () => {
  it.each(["octave_modules_declare_only_octave_packages", "a_module_in_another_package_fails"])("T3-29 item 4: NetworkPathsBytecodeTest.kt has the test %s", (name) => {
    const test = readKotlin("NetworkPathsBytecodeTest.kt");
    expect(test).toMatch(new RegExp(`@Test\\s+fun ${name}\\(\\)`));
  });

  it("T3-29 item 4: NetworkPathsBytecodeTest.kt runs scripts/octave-module-packages.mjs", () => {
    const test = readKotlin("NetworkPathsBytecodeTest.kt");
    expect(test).toContain("scripts/octave-module-packages.mjs");
  });
});
