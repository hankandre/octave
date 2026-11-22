// The TV's install id (T4-09): made once by the Crypto port and kept by the native install id module, so the DeviceId
// the gateway derives for a server and user survives a relaunch (ARCHITECTURE.md §3, DeviceId). Types only are
// imported, so Node can load this file; the wired source is hostInstallId in ./host-gateway.ts.
import type { Crypto } from "@octave/core/src/ports/crypto";
import type { OctaveInstallIdNative } from "@octave/install-id";

export type InstallIdSource = () => Promise<string>;

export const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const NOT_AVAILABLE = "The install id is not available.";

export const isInstallId = (value: unknown): value is string => typeof value === "string" && INSTALL_ID_PATTERN.test(value);

// `native` is a function so that importing this file loads no native module. The first call hands crypto.randomId()
// to keep(), which answers the stored id (or stores the candidate when none is). The answer is kept for the life of the
// runtime. A failure rejects with a fixed message and is not kept, so the next call tries again; it never answers the
// candidate, so a failure never becomes an id that lasts one launch.
export function createInstallIdSource(native: () => Pick<OctaveInstallIdNative, "keep">, crypto: Crypto): InstallIdSource {
  let kept: Promise<string> | undefined;
  const ask = async (): Promise<string> => {
    let answer: unknown;
    try {
      answer = await native().keep(crypto.randomId());
    } catch {
      throw new Error(NOT_AVAILABLE);
    }
    if (!isInstallId(answer)) throw new Error(NOT_AVAILABLE);
    return answer;
  };
  return () => {
    if (kept === undefined) {
      const asking = ask();
      kept = asking;
      asking.catch(() => {
        if (kept === asking) kept = undefined;
      });
    }
    return kept;
  };
}
