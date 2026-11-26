// The found-servers source until T4-01 supplies the native one: it finds none, so the sign-in step shows its address
// field (T4-02 D4). Pure, with no native import.
import type { ServerDiscovery } from "@octave/core/src/domain/server-discovery";

export const noServerDiscovery: ServerDiscovery = {
  discover: async () => ({ servers: [], refused: 0, dropped: 0 }),
};
