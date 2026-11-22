import { describe, expect, it } from "vitest";
import { redactText } from "./redact";
import { safeReason } from "./safe-reason";

// T9-07 item 5. Same scheme as redact-performance.test.ts: each input first
// runs at a small size against a scaled bound, so a quadratic pattern fails in
// under a second instead of running for minutes.
const ONE_MEGABYTE_BOUND_MS = 1000;
const SIZE = 1 << 20;
const GUARD_SIZE = 1 << 16;
const GUARD_BOUND_MS = 60;

function repeated(unit: string, size: number, suffix = ""): string {
  return unit.repeat(Math.ceil(size / unit.length)) + suffix;
}

function adversarial(size: number): string[] {
  return [
    repeated("a:", size, "@"),
    repeated("a@", size),
    repeated("%", size),
    repeated("::", size),
    repeated("1.", size),
    repeated("a.b ", size),
    repeated("/a b", size),
    repeated("C:\\a ", size),
    repeated("a b/", size),
    repeated("token (401) ", size),
    repeated("[fe80::1%", size),
    repeated(",a:", size, "@"),
  ];
}

function timeOf(filter: (value: string) => string, input: string): number {
  const started = performance.now();
  filter(input);
  return performance.now() - started;
}

describe.each([
  ["redactText", redactText],
  ["safeReason", safeReason],
])("%s on the T9-07 adversarial input", (_name, filter) => {
  it("stays linear on a small guard size", () => {
    for (const input of adversarial(GUARD_SIZE)) {
      expect(timeOf(filter, input), input.slice(0, 12)).toBeLessThan(GUARD_BOUND_MS);
    }
  });

  it("finishes 1 MB inputs within the bound", () => {
    for (const input of adversarial(SIZE)) {
      expect(timeOf(filter, input), input.slice(0, 12)).toBeLessThan(ONE_MEGABYTE_BOUND_MS);
    }
  });
});
