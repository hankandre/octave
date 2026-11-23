// The device capability probe the app composes into every gateway (T8-07): the player engine's initialize, which the
// Media3 engine answers from the platform's codec list. Building the engine is part of the probe, so a module that
// cannot load (tvOS, decision 0003) or an initialize that rejects is "cannot tell", never "can play". It asks the
// engine afresh on every call. No native import, so Node can load it.
import type { PlayerCapabilities, PlayerEngine } from "@octave/core/src/domain/player-engine";

export function createCapabilityProbe(engine: () => Pick<PlayerEngine, "initialize">): () => Promise<PlayerCapabilities> {
  return async () => {
    try {
      return await engine().initialize();
    } catch {
      return { probe: "failed" };
    }
  };
}
