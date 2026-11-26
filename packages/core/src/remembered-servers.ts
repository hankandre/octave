// The servers chosen before (T4-02 D6): no token and no user. This store holds them for one launch only.
import type { RememberedServer } from "./domain/server-choice";

export type { RememberedServer };

export interface RememberedServers {
  /** Most recent first, one entry per id. */
  list(): readonly RememberedServer[];
  /** A later choice of the same id replaces the earlier one and moves to the front. */
  remember(server: RememberedServer): void;
}

export class MemoryRememberedServers implements RememberedServers {
  private servers: readonly RememberedServer[] = [];

  list(): readonly RememberedServer[] {
    return this.servers;
  }

  remember({ id, name, address }: RememberedServer): void {
    this.servers = [{ id, name, address }, ...this.servers.filter((server) => server.id !== id)];
  }
}
