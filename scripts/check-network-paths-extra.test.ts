// @vitest-environment node
// T3-04, beyond the frozen samples in scripts/check-network-paths.test.ts: the Media3 paths that are not HTTP (spec
// check issue 6), react-native-worklets' script download (issue 3), and the identifier boundaries of the shared name
// list (issue 8). Not frozen.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSourceViolations, KOTLIN_RULES, OCTAVE_HTTP } from "./check-network-paths.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = "modules/session/android/src/main/java/dev/octave/session/Probe.kt";
const kotlin = (body: string) => ({ path: PROBE, text: `package dev.octave.session\n\n${body}\n` });
const alternative = (id: string) => KOTLIN_RULES.find((rule) => rule.id === id)!.alternative;

function expectFails(id: string, body: string): void {
  const found = findSourceViolations([kotlin(body)]);
  expect(
    found.some((line) => line.startsWith(`ERROR network: ${PROBE}:3: `) && line.includes(alternative(id))),
    `${id} on ${body}:\n${found.join("\n")}`,
  ).toBe(true);
}

const expectPasses = (body: string) => expect(findSourceViolations([kotlin(body)])).toEqual([]);

describe("T3-04 K1: Media3's network paths that are not HTTP (names read from the 1.11.1 artifacts)", () => {
  it.each([
    ["UdpDataSource", "val source = UdpDataSource()"],
    ["RtspMediaSource.Factory", "val media = RtspMediaSource.Factory().createMediaSource(item)"],
    ["RtmpDataSource.Factory", "val sources = RtmpDataSource.Factory()"],
    ["an import of RtspMediaSource", "import androidx.media3.exoplayer.rtsp.RtspMediaSource"],
    ["a full name in a string", 'val type = Class.forName("androidx.media3.datasource.rtmp.RtmpDataSource")'],
  ])("K1 fails %s", (_name, body) => expectFails("K1", body));
});

describe("T3-04 K7: react-native-worklets' networking and script download", () => {
  it.each([
    ["the networking package", "import com.swmansion.worklets.networking.Networking"],
    ["ScriptBufferWrapper", "import com.swmansion.worklets.ScriptBufferWrapper"],
  ])("K7 fails %s", (_name, body) => expectFails("K7", body));

  it("K7 passes another worklets class", () => expectPasses("import com.swmansion.worklets.WorkletsModule"));
});

describe("T3-04: identifier boundaries", () => {
  it.each([
    ["an identifier that ends WebView", "val shown = hasWebView()"],
    ["a socket factory call", "val socket = factory.createSocket()"],
    ["a word in a string", 'throw java.io.IOException("open a URL connection over a socket, then a WebView")'],
    ["a URL in a string", 'val address = "http://192.0.2.1/".toHttpUrl()'],
    ["a character literal quote", "val quote = '\"'\nval other = 1"],
  ])("passes %s", (_name, body) => expectPasses(body));

  it("a raw string's full name fails, on its own line", () => {
    const text = 'package x\n\nval kotlin = """\n    val c = okhttp3.OkHttpClient()\n"""\n';
    const found = findSourceViolations([{ path: PROBE, text }]);
    expect(found.some((line) => line.startsWith(`ERROR network: ${PROBE}:4: `) && line.includes(alternative("K4"))), found.join("\n")).toBe(true);
  });

  it("a socket in DirectSocketFactory.kt passes and the same line elsewhere fails", () => {
    const direct = "modules/session/android/src/main/java/dev/octave/session/http/DirectSocketFactory.kt";
    expect(findSourceViolations([{ path: direct, text: "package x\n\nval s = Socket(Proxy.NO_PROXY)\n" }])).toEqual([]);
    expectFails("K4", "val s = Socket(Proxy.NO_PROXY)");
  });

  it("OctaveHttp.kt's own builder passes, and the same builder elsewhere fails", () => {
    expect(findSourceViolations([{ path: OCTAVE_HTTP, text: readFileSync(join(repo, OCTAVE_HTTP), "utf8") }])).toEqual([]);
    expectFails("K4", "val client = OkHttpClient.Builder().build()");
  });
});
