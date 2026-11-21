// Every `*.android.*` file in apps/tv needs a sibling the tvOS build can load: a base file or an `*.ios.*` file in the
// same directory (T3-01 item 6). scripts/tv-platform.test.ts runs this over the real tree inside `pnpm test`.
import { posix } from "node:path";

const PLATFORM_FILE = /^(.+)\.android(\.[^./]+)$/;

// Returns the orphan `*.android.*` paths, in input order. Paths use forward slashes.
export function findOrphanPlatformFiles(paths) {
  return paths.filter((path) => {
    const dir = posix.dirname(path);
    const match = PLATFORM_FILE.exec(posix.basename(path));
    if (match === null) return false;
    const [, stem] = match;
    return !paths.some((other) => {
      if (other === path || posix.dirname(other) !== dir) return false;
      const name = posix.basename(other);
      if (PLATFORM_FILE.test(name)) return false;
      return name.startsWith(`${stem}.`) && /^(\.ios)?\.[^.]+$/.test(name.slice(stem.length));
    });
  });
}
