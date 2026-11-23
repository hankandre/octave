// T8-01 review: the launch vectors on the edges of the core's host grammar (a host with `_`, an IPv6 literal, a host
// in upper or mixed case) are what the core builds. LaunchRequestHostEdgesTest checks the Kotlin reader accepts each.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LaunchRequest, PlaybackPlan } from "../packages/core/src/domain/playback";
import { launchRequest } from "../packages/core/src/player/launch-request";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type Vector = { name: string; sessionId: string; plan: PlaybackPlan; request: LaunchRequest };

describe("the launch vectors on the edges of the host grammar", () => {
  const fixture = JSON.parse(
    readFileSync(join(repo, "packages/core/tests/fixtures/launch-requests-host-edges.json"), "utf8"),
  ) as { vectors: Vector[] };

  it("hold both kinds and every edge of rule R2", () => {
    expect(new Set(fixture.vectors.map((vector) => vector.request.kind))).toEqual(new Set(["original", "hls"]));
    const urls = fixture.vectors.map((vector) =>
      vector.request.kind === "original" ? vector.request.url : vector.request.masterUrl,
    );
    expect(urls.some((url) => new URL(url).hostname.includes("_"))).toBe(true);
    expect(urls.some((url) => new URL(url).hostname.startsWith("["))).toBe(true);
    const plans = fixture.vectors.map((vector) => vector.plan.streamUrl);
    expect(plans.some((url) => /:\/\/[^/]*[A-Z]/.test(url))).toBe(true);
  });

  it("are what the core builds", () => {
    for (const vector of fixture.vectors) {
      expect(launchRequest(vector.plan, vector.sessionId), `the core builds ${vector.name}`).toEqual(vector.request);
    }
  });
});
