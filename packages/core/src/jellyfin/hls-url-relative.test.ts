import { describe, expect, it } from "vitest";
import { rebuildMasterUrl, type HlsUrlContext } from "./hls-url";

const ITEM = "0123456789abcdef0123456789abcdef";
const context: HlsUrlContext = { serverUrl: "https://media.test", itemId: ITEM, mediaSourceId: ITEM, mediaKind: "videos", playSessionId: "p1" };
const TAIL = `/videos/${ITEM}/master.m3u8?MediaSourceId=${ITEM}&PlaySessionId=p1`;

// The WHATWG parser reads `/\` as `//` and drops tabs and newlines, so these
// are not paths on the server and must never be treated as relative.
describe("hls-url: a path-looking value that parses as another authority", () => {
  it.each([
    ["backslash host", `/\\evil.example${TAIL}`],
    ["backslash same host", `/\\media.test${TAIL}`],
    ["tab then slash", `/\t/evil.example${TAIL}`],
    ["newline then slash", `/\n/evil.example${TAIL}`],
    ["carriage return then slash", `/\r/evil.example${TAIL}`],
    ["backslash encoded host", `/\\media%2Etest${TAIL}`],
    ["tab then backslash", `/\t\\evil.example${TAIL}`],
  ])("refuses %s", (_name, value) => {
    expect(rebuildMasterUrl(value, context).ok).toBe(false);
  });

  it("accepts a normal relative path", () => {
    const result = rebuildMasterUrl(TAIL, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.startsWith("https://media.test/videos/")).toBe(true);
  });
});
