// @vitest-environment node
// T3-04 review findings: `java.net.URL` behind an import alias, code inside a Kotlin string template, players and
// image loaders that fetch without the header, and the npm dependencies of a workspace package. Not frozen.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findLinkedClients, findSourceViolations, KOTLIN_RULES, linkedPackages, opensConnection, splitSource } from "./check-network-paths.mjs";

const PROBE = "modules/session/android/src/main/java/dev/octave/session/Probe.kt";
const kotlin = (body: string, path = PROBE) => ({ path, text: `package dev.octave.session\n\n${body}\n` });
const alternative = (id: string) => KOTLIN_RULES.find((rule) => rule.id === id)!.alternative;

function expectFails(id: string, body: string, line = 3): void {
  const found = findSourceViolations([kotlin(body)]);
  expect(
    found.some((entry) => entry.startsWith(`ERROR network: ${PROBE}:${line}: `) && entry.includes(alternative(id))),
    `${id} on ${body}:\n${found.join("\n")}`,
  ).toBe(true);
}

const expectPasses = (body: string) => expect(findSourceViolations([kotlin(body)])).toEqual([]);

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "octave-network-review-"));
  roots.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("T3-04 review K5: java.net.URL as a name", () => {
  it.each([
    ["an aliased import", "import java.net.URL as Net"],
    ["an aliased import, before its use", 'import java.net.URL as Net\nfun read(): String = Net("http://192.0.2.1/x").readText()'],
    ["a URL by full name", "val u = java.net.URL(address)"],
    ["a typealias over a star import", "typealias Net = URL"],
    ["a function reference", "val make = ::URL"],
    ["a full name in a string", 'val type = Class.forName("java.net.URL")'],
  ])("K5 fails %s", (_name, body) => expectFails("K5", body));

  it.each([
    ["URLEncoder", "import java.net.URLEncoder"],
    ["an identifier that ends URL", "val refused = HttpRefusal.CREDENTIAL_URL"],
    ["HttpUrl", "import okhttp3.HttpUrl"],
    ["the word in a message", 'throw java.io.IOException("refused a URL")'],
  ])("K5 passes %s", (_name, body) => expectPasses(body));
});

describe("T3-04 review: the code of a Kotlin string template is code", () => {
  it.each([
    ["K4", "a client in a template", 'val s = "${OkHttpClient().newCall(req).execute().body}"'],
    ["K9", "a WebView in a template", 'val f = "${WebView(ctx)}"'],
    ["K5", "a URL with a nested string in a template", 'val s = "${URL("http://192.0.2.1").openStream()}"'],
    ["K4", "a client after a nested template", 'val s = "a ${items.map { "${it}" }} b"; val c = okhttp3.OkHttpClient()'],
    ["K4", "a client in a raw string's template", 'val s = """x ${OkHttpClient()} y"""'],
  ])("%s fails %s", (id, _name, body) => expectFails(id, body));

  it("keeps the line of code after a multi-line template", () => expectFails("K4", 'val s = "${listOf(\n1)}"\nval c = OkHttpClient()', 5));

  it.each([
    ["a URL text with a template", 'val s = "http://192.0.2.1/${path}" // a comment'],
    ["an escaped dollar", 'val s = "\\${OkHttpClient()}"'],
    ["a simple template", 'val s = "$client is ready"'],
  ])("passes %s", (_name, body) => expectPasses(body));

  it("reads a Java string as text: Java has no templates", () => {
    const java = 'class P { String s = "${OkHttpClient()}"; }\n';
    expect(opensConnection(java, { templates: false })).toBe(false);
    expect(opensConnection(java)).toBe(true);
    expect(splitSource(java, { templates: false })[0].strings).toEqual(["${OkHttpClient()}"]);
  });

  it("the inventory reads a linked Kotlin file's template as code and a Java file's as text", () => {
    const opener = 'val s = "${java.net.URL("http://192.0.2.1").openStream()}"\n';
    const dir = tree({
      "android/src/main/java/probe/K.kt": opener,
      "android/src/main/java/probe/J.java": 'class J { String s = "${URL(x).openStream()}"; }\n',
    });
    expect(findLinkedClients([{ name: "probe-lib", dir }]).map((found) => found.file)).toEqual(["android/src/main/java/probe/K.kt"]);
  });
});

describe("T3-04 review K4: players and image loaders that fetch without the header", () => {
  it.each([
    ["MediaPlayer", 'val player = android.media.MediaPlayer().apply { setDataSource("http://192.0.2.1/v.mkv") }'],
    ["an import of MediaPlayer", "import android.media.MediaPlayer"],
    ["VideoView", "fun play(view: VideoView) = view.setVideoURI(uri)"],
    ["Coil", "import coil.load"],
    ["Coil 3", "import coil3.request.ImageRequest"],
    ["Glide", "val request = Glide.with(context)"],
    ["an import of Glide", "import com.bumptech.glide.Glide"],
    ["Picasso", "import com.squareup.picasso.Picasso"],
    ["Glide by name in a string", 'val type = Class.forName("com.bumptech.glide.Glide")'],
  ])("K4 fails %s", (_name, body) => expectFails("K4", body));

  it.each([
    ["a name that holds coil", "val coilSpring = 1"],
    ["a member named coil", "val spring = settings.coil"],
    ["MediaPlayerState", "val state = MediaPlayerState.Idle"],
  ])("passes %s", (_name, body) => expectPasses(body));

  it("the inventory lists a linked file that plays through MediaPlayer", () => {
    const dir = tree({ "android/src/main/java/probe/P.kt": "val p = android.media.MediaPlayer()\n" });
    expect(findLinkedClients([{ name: "probe-lib", dir }]).map((found) => found.file)).toEqual(["android/src/main/java/probe/P.kt"]);
  });
});

describe("T3-04 review: a workspace package's dependencies are linked too", () => {
  it("follows a workspace package's npm dependencies without listing the workspace package", () => {
    const pkg = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({ name, version: "1.0.0", ...extra });
    const root = tree({
      "apps/tv/package.json": pkg("@octave/tv", { dependencies: { "@octave/image": "workspace:*" } }),
      "modules/image/package.json": pkg("@octave/image", { dependencies: { "expo-image": "1" } }),
      "modules/image/android/src/main/java/I.kt": "val i = 1\n",
      "modules/image/node_modules/expo-image/package.json": pkg("expo-image"),
      "modules/image/node_modules/expo-image/android/src/main/java/E.kt": "val e = 1\n",
    });
    mkdirSync(join(root, "apps", "tv", "node_modules", "@octave"), { recursive: true });
    symlinkSync(join(root, "modules", "image"), join(root, "apps", "tv", "node_modules", "@octave", "image"), "dir");
    const { packages, errors } = linkedPackages(root);
    expect(errors).toEqual([]);
    expect(packages.map((found) => found.name)).toEqual(["expo-image"]);
  });
});
