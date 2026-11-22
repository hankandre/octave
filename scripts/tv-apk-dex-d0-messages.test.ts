// @vitest-environment node
// The message of each D0 rule of the release APK's dex check (scripts/tv-apk-dex.mjs; docs/specs/T3-29.md, "D0: the
// marker and the damaged APK", one case per row of its table). Not frozen on purpose: T3-29 item 2 wants these texts in
// a file a later task can change. T3-19's frozen file checks six of these rules only by failure.
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, composeDump, composeMapping, dexBytes, loadFixtureLists, r8Marker, runDex, zip } from "./fixtures/tv/dex/harness";
import { cleanRunnerTemps, runRaw } from "./fixtures/tv/dex/t3-29/runner";

const TIMEOUT = 60_000;
const FIXTURE_APK = "apps/tv/android/app/build/outputs/apk/release/app-release.apk";

afterAll(() => {
  cleanTemps();
  cleanRunnerTemps();
});

type Out = { code: number | null; out: string };
const errors = (run: Out) => run.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex:"));

/** The run fails and one of its ERROR lines holds every part. */
function expectLine(run: Out, ...parts: string[]): void {
  expect(run.code, run.out).toBe(1);
  expect(
    errors(run).some((line) => parts.every((part) => line.includes(part))),
    `an ERROR line holds ${parts.join(" and ")}:\n${run.out}`,
  ).toBe(true);
}

const manifest = { name: "AndroidManifest.xml", data: Buffer.from("not read by the dex check") };

/** A whole APK with a stored classes.dex, then `patch` applied to classes.dex's central header at `at`. */
function patchedApk(patch: (buf: Buffer, at: number) => void): Buffer {
  const buf = Buffer.from(zip([manifest, { name: "classes.dex", data: dexBytes() }]));
  const end = buf.length - 22;
  let at = buf.readUInt32LE(end + 16);
  for (let n = 0; n < buf.readUInt16LE(end + 10); n += 1) {
    const nameLength = buf.readUInt16LE(at + 28);
    if (buf.toString("utf8", at + 46, at + 46 + nameLength) === "classes.dex") {
      patch(buf, at);
      return buf;
    }
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  throw new Error("no classes.dex in the zip");
}

async function runApk(apk: Buffer): Promise<Out> {
  return runRaw({
    apk,
    mapping: composeMapping(),
    dump: composeDump().split(FIXTURE_APK).join("{apk}"),
    lists: { ...(await loadFixtureLists()).FIXTURE_LISTS },
  });
}

describe("T3-29 the message of each D0 rule", () => {
  it("D0 row 1: no APK says where it looked and to run pnpm tv:build", async () => expectLine(await runDex({ noApk: true }), "no release APK at", "pnpm tv:build"), TIMEOUT);

  it("D0 row 2: no mapping says where it looked and to run pnpm tv:build", async () => expectLine(await runDex({ noMapping: true }), "no R8 mapping at", "pnpm tv:build"), TIMEOUT);

  it(
    "D0 row 3: a truncated APK says it is truncated or damaged and to run pnpm tv:build",
    async () => {
      const whole = zip([manifest, { name: "classes.dex", data: dexBytes(), deflate: true }]);
      const run = await runApk(whole.subarray(0, whole.length - 12));
      expectLine(run, "is truncated or damaged", "no zip end record", "pnpm tv:build");
      expect(errors(run)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    "D0 row 4: a zip64 entry says so",
    async () => expectLine(await runApk(patchedApk((buf, at) => buf.writeUInt32LE(0xffffffff, at + 20))), "classes.dex is a zip64 entry"),
    TIMEOUT,
  );

  it(
    "D0 row 5: a zip method the check does not read says which",
    async () => expectLine(await runApk(patchedApk((buf, at) => buf.writeUInt16LE(12, at + 10))), "classes.dex uses zip method 12"),
    TIMEOUT,
  );

  it("D0 row 6: an APK with no dex says so", async () => expectLine(await runDex({ apkEntries: [manifest] }), "holds no classes*.dex"), TIMEOUT);

  it(
    "D0 row 7: a mapping with no pg_map_id line says it is not an R8 mapping",
    async () => expectLine(await runDex({ mapping: composeMapping().replace(/^# pg_map_id: .*\n/m, "") }), "has no pg_map_id line"),
    TIMEOUT,
  );

  it(
    "D0 row 8: a dex with no R8 marker says so",
    async () => expectLine(await runDex({ apkEntries: [{ name: "classes.dex", data: dexBytes(null), deflate: true }] }), "classes.dex has no R8 marker"),
    TIMEOUT,
  );

  it(
    "D0 row 9: an R8 marker with no pg-map-id says it cannot be matched and to run pnpm tv:build",
    async () => {
      const marker = '~~R8{"backend":"dex","compilation-mode":"release","min-api":24,"version":"9.2.14"}';
      const run = await runDex({ apkEntries: [{ name: "classes.dex", data: dexBytes(marker), deflate: true }] });
      expectLine(run, "classes.dex has an R8 marker but no pg-map-id", "pnpm tv:build");
    },
    TIMEOUT,
  );

  it(
    "D0 row 10: a mapping from another build names both ids and says to run pnpm tv:build",
    async () => {
      const other = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const run = await runDex({ apkEntries: [{ name: "classes.dex", data: dexBytes(r8Marker(other)), deflate: true }] });
      expectLine(run, `was built with mapping ${other}`, "pnpm tv:build");
    },
    TIMEOUT,
  );

  it("D0 row 11: dexdump exiting non-zero gives its exit code", async () => expectLine(await runDex({ dexdumpExit: 2 }), "dexdump exited 2"), TIMEOUT);

  it(
    "D0 row 12: dexdump opening fewer dex files than the APK holds gives both counts",
    async () => {
      const run = await runDex({
        apkEntries: [
          { name: "classes.dex", data: dexBytes(), deflate: true },
          { name: "classes2.dex", data: dexBytes(), deflate: true },
        ],
      });
      expectLine(run, "dexdump opened 1 dex files, but the APK holds 2");
    },
    TIMEOUT,
  );

  it(
    "D0 row 13: a listing with no class says so",
    async () => expectLine(await runDex({ dump: `Processing '${FIXTURE_APK}'...\nOpened '${FIXTURE_APK}', DEX version '037'\n` }), "the dexdump listing holds no class"),
    TIMEOUT,
  );

  it(
    "D0 row 14: a listing with no sink reference says the check would see nothing",
    async () => {
      const dump = `Processing '${FIXTURE_APK}'...\nOpened '${FIXTURE_APK}', DEX version '037'\nClass #0            -\n  Class descriptor  : 'Lzz9;'\n  Superclass        : 'Ljava/lang/Object;'\n`;
      expectLine(await runDex({ dump }), "the dexdump listing holds no sink reference");
    },
    TIMEOUT,
  );

  it(
    "D0 row 15: a listing with no dev.octave. class says Octave's code is missing",
    async () => {
      const dump = composeDump().replace(/^Class #4348 [\s\S]*?(?=^Class #)/m, "");
      expectLine(await runDex({ dump }), "the dexdump listing holds no dev.octave. class");
    },
    TIMEOUT,
  );

  it(
    "D0 row 16: a mapping with okhttp3 classes but no okhttp3.OkHttpClient class line says S1 cannot be found",
    async () => {
      const mapping = composeMapping().replace(/^okhttp3\.OkHttpClient -> vr1:\n/m, "");
      expectLine(await runDex({ mapping }), "no class line for okhttp3.OkHttpClient");
    },
    TIMEOUT,
  );
});
