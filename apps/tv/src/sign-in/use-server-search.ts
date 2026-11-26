// The search for servers on the home network (T4-02 D4): once on arrival, and again on Search again. A search that
// fails counts as none found.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DiscoveredServer, ServerDiscovery } from "@octave/core/src/domain/server-discovery";

export function useServerSearch(discovery: ServerDiscovery) {
  /** Undefined until the first search settles. */
  const [found, setFound] = useState<readonly DiscoveredServer[] | undefined>(undefined);
  const latest = useRef(0);

  /** Resolves the servers found, or undefined when a newer search or leaving the step replaced this one. */
  const search = useCallback(async () => {
    latest.current += 1;
    const mine = latest.current;
    let servers: readonly DiscoveredServer[] = [];
    try {
      servers = (await discovery.discover()).servers;
    } catch {
      servers = [];
    }
    if (mine !== latest.current) return undefined;
    setFound(servers);
    return servers;
  }, [discovery]);

  useEffect(() => {
    void search();
    return () => {
      latest.current += 1;
    };
  }, [search]);

  return { found, search };
}
