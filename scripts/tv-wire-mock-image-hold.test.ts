// @vitest-environment node
// The wire mock's image hold (T3-39, docs/specs/T3-39.md, "Files to touch"): off by default, it holds each image answer
// for a fixed time so the BlurHash preview can be captured, and refuses a hold outside 0 to MAX_IMAGE_HOLD_MS.
import { afterEach, describe, expect, it } from "vitest";
import { MAX_IMAGE_HOLD_MS, startMock } from "./tv-wire-mock.mjs";

const CANARY = "wire-canary-image-hold";
const USER = "wire-user";
const PASSWORD = "wire-password";
const IMAGE = "/Items/f6000000000000000000000000000000/Images/Primary?maxWidth=248";

type Mock = Awaited<ReturnType<typeof startMock>>;
let mock: Mock | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function start(imageHoldMs?: number): Promise<Mock> {
  mock = await startMock({ canary: CANARY, user: USER, password: PASSWORD, canaryDevicePort: 1, ...(imageHoldMs === undefined ? {} : { imageHoldMs }) });
  return mock;
}

async function timedImage(port: number): Promise<{ status: number; type: string | null; ms: number }> {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}${IMAGE}`, { headers: { Authorization: `MediaBrowser Token="${encodeURIComponent(CANARY)}"` } });
  await response.arrayBuffer();
  return { status: response.status, type: response.headers.get("content-type"), ms: performance.now() - started };
}

describe("T3-39: the wire mock's image hold", () => {
  it("answers an image at once by default", async () => {
    const { ports } = await start();
    const answer = await timedImage(ports.main);
    expect(answer.status).toBe(200);
    expect(answer.type).toBe("image/png");
    expect(answer.ms).toBeLessThan(400);
  });

  it("holds each image answer for imageHoldMs", async () => {
    const { ports } = await start(600);
    const answer = await timedImage(ports.main);
    expect(answer.status).toBe(200);
    expect(answer.type).toBe("image/png");
    expect(answer.ms).toBeGreaterThanOrEqual(590);
  });

  it("refuses a hold that is negative, fractional or above the bound", async () => {
    expect(MAX_IMAGE_HOLD_MS).toBe(10_000);
    for (const imageHoldMs of [-1, 1.5, MAX_IMAGE_HOLD_MS + 1, Number.NaN]) {
      await expect(start(imageHoldMs)).rejects.toThrow(/imageHoldMs/);
    }
    mock = undefined;
  });
});
