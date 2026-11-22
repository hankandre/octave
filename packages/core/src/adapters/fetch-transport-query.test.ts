// @vitest-environment node
// T3-05: the shared query vectors (tests/fixtures/transport-query-encoding.json) are the reference adapter's own
// output. Kotlin's QueryEncoding must write the same bytes (QueryEncodingTest), so this test keeps the file honest:
// FetchTransport.request hands fetch the URL it built, and its query is each vector's `expected`, before any URL
// parser runs (a WHATWG or OkHttp parser then writes `'` as `%27`; see the file's note).
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../tests/fixtures/transport-query-encoding.json";
import type { QueryPair } from "../ports/transport";
import { FetchTransport } from "./fetch-transport";
import { systemClock } from "./system-clock";
import { webCrypto } from "./web-crypto";

type Vector = { name: string; query: [string, string][]; expected: string };
const vectors = fixture.vectors as Vector[];

afterEach(() => {
  vi.unstubAllGlobals();
});

async function queryOf(pairs: readonly QueryPair[]): Promise<string> {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: unknown) => {
    urls.push(String(url));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  const adapter = new FetchTransport({ client: { version: "0.1.0", deviceName: "Octave Test" }, crypto: webCrypto, clock: systemClock });
  await adapter.request({
    target: { server: "http://127.0.0.1:8096", deviceId: "device-1" },
    method: "GET",
    path: "/System/Info/Public",
    query: pairs,
    timeoutMs: 5_000,
  });
  expect(urls).toHaveLength(1);
  const [base, ...rest] = urls[0].split("?");
  expect(base).toBe("http://127.0.0.1:8096/System/Info/Public");
  return rest.join("?");
}

describe("T3-05: the shared query-encoding vectors", () => {
  it("cover the characters the spec names", () => {
    const text = vectors.flatMap((vector) => vector.query.flat()).join("");
    for (const character of [" ", ":", "$", ",", "!", "*", "'", "(", ")", "~", "+", "&", "=", "%", "é", "🎬"]) {
      expect(text, character).toContain(character);
    }
    expect(new Set(vectors.map((vector) => vector.name)).size).toBe(vectors.length);
  });

  it.each(vectors.map((vector) => [vector.name, vector] as const))("the reference adapter writes %s as expected", async (_name, vector) => {
    expect(await queryOf(vector.query)).toBe(vector.expected);
  });
});
