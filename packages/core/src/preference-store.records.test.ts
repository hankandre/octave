// T9-02 (docs/specs/T9-02.md, D4 and milestone 2): the record texts shared with the native store's PreferencesStoreTest.
// The native store accepts exactly `accepted`, so it must be exactly what encodeDeviceRecord writes.
import { describe, expect, it } from "vitest";
import records from "../tests/fixtures/preference-records.json";
import { DEFAULT_PREFERENCES, decodeDeviceRecord, encodeDeviceRecord } from "./preference-store";
import { STREAMING_LIMIT_CHOICES_MBPS, type StreamingLimits } from "./streaming-limits";

const OPTIONS: (number | undefined)[] = [undefined, ...STREAMING_LIMIT_CHOICES_MBPS];
const ALL_LIMITS: StreamingLimits[] = OPTIONS.flatMap((localMbps) =>
  OPTIONS.map((remoteMbps) => ({
    ...(localMbps === undefined ? {} : { localMbps }),
    ...(remoteMbps === undefined ? {} : { remoteMbps }),
  })),
);

describe("T9-02 shared preference record vectors", () => {
  it("accepted is exactly the encoder's text for the 81 limit combinations", () => {
    const written = ALL_LIMITS.map((limits) => encodeDeviceRecord({ ...DEFAULT_PREFERENCES, streamingLimits: limits }));
    expect(written).toHaveLength(81);
    expect([...records.accepted].sort()).toEqual([...written].sort());
  });

  it("every accepted vector decodes to its limits without falling back", () => {
    for (const text of records.accepted) {
      const limits = (JSON.parse(text) as { streamingLimits: StreamingLimits }).streamingLimits;
      expect(decodeDeviceRecord(text)).toEqual({ ...DEFAULT_PREFERENCES, streamingLimits: limits });
    }
  });

  it("no refused vector is text the encoder writes", () => {
    const accepted = new Set(records.accepted);
    expect(records.refused.length).toBeGreaterThan(0);
    expect(records.refused.filter((text) => accepted.has(text))).toEqual([]);
  });
});
