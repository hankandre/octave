// @vitest-environment node
// T8-02 (docs/specs/T8-02.md, "Threading" and E3a; spec check issues 3 and 7): source facts of the Media3 engine
// beside item 1's frozen ones. Every engine method runs on the main looper, inline when the caller is already on it,
// so the module's OnDestroy, whose thread Expo does not state, never waits on the main thread from the main thread;
// once the module is destroyed the engine refuses every call but stop; a player's signal reaches the core only while
// it is the current launch's; first-frame comes only from a presented frame (item 2's adapter side); the decoder's
// flags are looked up under the type Media3 may decode the track as. Not frozen.
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
    expect(engine).toMatch(/onMainThread\s*=\s*\{\s*Looper\s*\.\s*myLooper\(\)\s*==\s*Looper\s*\.\s*getMainLooper\(\)\s*\}/);
    expect(engine).toMatch(/post\s*=\s*\{\s*work\s*->\s*main\s*\.\s*post\s*\(\s*work\s*\)\s*\}/);
    expect(engine).toMatch(/MAIN_WAIT_MILLIS\s*=\s*10_000L/);
    const gate = code(`${MAIN}/engine/MainThreadGate.kt`);
    expect(gate).toMatch(/if\s*\(\s*onMainThread\(\)\s*\)\s*\{\s*call\s*\.\s*run\(\)/);
    expect(gate).toMatch(/finished\s*\.\s*await\s*\(\s*waitMillis\s*,\s*TimeUnit\s*\.\s*MILLISECONDS\s*\)/);
  });

  it("routes every PlaybackEngine command but capabilities and setListener through the gate, and undoes a late launch", () => {
    for (const command of ["setPaused", "seek", "selectTrack"]) {
      expect(engine, command).toMatch(new RegExp(`override fun ${command}\\([^)]*\\)\\s*=\\s*gate\\s*\\.\\s*run\\s*\\{`));
    }
    expect(engine).toMatch(/override fun launch\([^)]*\)\s*=\s*gate\s*\.\s*run\s*\(\s*undoLate\s*=\s*::release\s*\)\s*\{/);
    expect(engine).toMatch(/override fun stop\(\)\s*=\s*gate\s*\.\s*runEvenWhenClosed\s*\(\s*::release\s*\)/);
  });

  it("marks the module destroyed, then stops the engine, before its command queue closes", () => {
    const module = code(`${MAIN}/OctavePlayerModule.kt`);
    expect(module).toMatch(/OnDestroy\s*\{\s*destroyed\s*=\s*true\s*seam\s*\.\s*stop\(\)\s*commands\s*\.\s*close\(\)\s*\}/);
    expect(module).toMatch(/Media3Engine\s*\([^)]*closed\s*=\s*\{\s*destroyed\s*\}/);
    expect(module).toMatch(/@Volatile\s*private var destroyed = false/);
  });

  it("passes a handle's signal to the core only while it is the current launch's", () => {
    expect(engine).toMatch(/if\s*\(\s*core\s*\.\s*isCurrent\s*\(\s*handle\s*\)\s*\)\s*core\s*\.\s*signal\s*\(\s*signal\s*\)/);
  });

  it("builds the player on the main looper", () => {
    expect(code(`${MAIN}/media3/Media3Handle.kt`)).toMatch(/\.setLooper\s*\(\s*Looper\s*\.\s*getMainLooper\(\)\s*\)/);
  });
});

describe("T8-02: the Media3 handle's signals", () => {
  const handle = code(`${MAIN}/media3/Media3Handle.kt`);

  it("T8-02 item 2: sends FirstFrameRendered only from onRenderedFirstFrame, never from a state or loading callback", () => {
    expect(handle.match(/FirstFrameRendered/g) ?? []).toHaveLength(1);
    expect(handle).toMatch(/override fun onRenderedFirstFrame\(\)\s*=\s*signal\s*\(\s*this\s*,\s*EngineSignal\s*\.\s*FirstFrameRendered\s*\)/);
    expect(handle).not.toMatch(/onIsLoadingChanged|onLoadStarted|onLoadCompleted/);
  });

  it("looks the decoder up under the track's type and the type Media3 may decode it as", () => {
    expect(handle).toMatch(/listOfNotNull\s*\(\s*format\s*\.\s*sampleMimeType\s*,\s*MediaCodecUtil\s*\.\s*getAlternativeCodecMimeType\s*\(\s*format\s*\)\s*\)/);
    expect(handle).toMatch(/types\s*\.\s*firstNotNullOfOrNull\s*\{[\s\S]*?MediaCodecUtil\s*\.\s*getDecoderInfos\s*\(\s*type\s*,/);
  });
});
