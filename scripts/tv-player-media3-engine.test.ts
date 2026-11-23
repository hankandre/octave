// @vitest-environment node
// T8-02 (docs/specs/T8-02.md, "Threading" and E3a; spec check issues 3 and 7): source facts of the Media3 engine
// beside item 1's frozen ones. Every engine method runs on the main looper, inline when the caller is already on it,
// so the module's OnDestroy, whose thread Expo does not state, never waits on the main thread from the main thread;
// a player's signal reaches the core only while it is the current launch's. Not frozen.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = "modules/player/android/src/main/java/dev/octave/player";
const code = (path: string) =>
  readFileSync(join(repo, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, "");

describe("T8-02: the Media3 engine's threads", () => {
  const engine = code(`${MAIN}/media3/Media3Engine.kt`);

  it("runs a call inline on the main looper and posts it from any other thread, waiting a bounded time", () => {
    expect(engine).toMatch(/if\s*\(\s*Looper\s*\.\s*myLooper\(\)\s*==\s*Looper\s*\.\s*getMainLooper\(\)\s*\)\s*return\s+work\(\)/);
    expect(engine).toMatch(/main\s*\.\s*post\s*\(/);
    expect(engine).toMatch(/\.get\s*\(\s*MAIN_WAIT_SECONDS\s*,\s*TimeUnit\s*\.\s*SECONDS\s*\)/);
    expect(engine).toMatch(/MAIN_WAIT_SECONDS\s*=\s*10L/);
  });

  it("routes every PlaybackEngine command but capabilities and setListener through onMain", () => {
    for (const command of ["launch", "setPaused", "seek", "selectTrack", "stop"]) {
      expect(engine, command).toMatch(new RegExp(`override fun ${command}\\([^)]*\\)\\s*=\\s*onMain\\s*\\{`));
    }
  });

  it("stops the engine when the module is destroyed, before its command queue closes", () => {
    const module = code(`${MAIN}/OctavePlayerModule.kt`);
    expect(module).toMatch(/OnDestroy\s*\{\s*seam\s*\.\s*stop\(\)\s*commands\s*\.\s*close\(\)\s*\}/);
  });

  it("passes a handle's signal to the core only while it is the current launch's", () => {
    expect(engine).toMatch(/if\s*\(\s*core\s*\.\s*isCurrent\s*\(\s*handle\s*\)\s*\)\s*core\s*\.\s*signal\s*\(\s*signal\s*\)/);
  });

  it("builds the player on the main looper", () => {
    expect(code(`${MAIN}/media3/Media3Handle.kt`)).toMatch(/\.setLooper\s*\(\s*Looper\s*\.\s*getMainLooper\(\)\s*\)/);
  });
});
