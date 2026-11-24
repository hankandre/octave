// @vitest-environment node
// T3-37 review fixes: an address next to a hex prefix or a port, an octal dotted part, and the apksigner spawn error.
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
type Addresses = { redactAddresses(text: string, addresses: string[]): string };
const load = async (): Promise<Addresses> => (await import(pathToFileURL(join(repo, "scripts", "tv-adb-addresses.mjs")).href)) as Addresses;

describe("redactAddresses in more positions", () => {
  it("replaces an address with a port, a hex-like prefix or a long spelling", async () => {
    const { redactAddresses } = await load();
    expect(redactAddresses("peer fd00::1234:5555 up", ["fd00::1234"])).toBe("peer [device]:5555 up");
    expect(redactAddresses("ADB:fd00::1234", ["fd00::1234"])).toBe("ADB:[device]");
    expect(redactAddresses("code:fd00::1234", ["fd00::1234"])).toBe("code:[device]");
    expect(redactAddresses("/2001:db8:0:0:0:0:0:7:5555", ["2001:db8::7"])).toBe("/[device]:5555");
    expect(redactAddresses("beef:2001:0db8::7", ["2001:db8::7"])).toBe("beef:[device]");
  });
  it("leaves an unrelated address alone", async () => {
    const { redactAddresses } = await load();
    expect(redactAddresses("fd00::9999:5555", ["fd00::1234"])).toBe("fd00::9999:5555");
  });
  it("replaces an octal dotted spelling of an IPv4 address", async () => {
    const { redactAddresses } = await load();
    expect(redactAddresses("peer 0300.0.2.44 up", ["192.0.2.44"])).toBe("peer [device] up");
  });
});

describe("readCerts", () => {
  it("hides the host path of a spawn error", async () => {
    const mod = (await import(pathToFileURL(join(repo, "scripts", "tv-apk-signing.mjs")).href)) as { readCerts(a: string, b: string): string };
    const missing = join(process.env.HOME ?? "/home/x", "no-such-dir", "apksigner");
    let message = "";
    try {
      mod.readCerts(missing, "x.apk");
    } catch (caught) {
      message = (caught as Error).message;
    }
    expect(message).toContain("could not run apksigner");
    expect(message).not.toContain(missing);
  });
});
