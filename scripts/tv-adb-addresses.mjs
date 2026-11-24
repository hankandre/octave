// Addresses in the TV scripts' output (T3-37; docs/specs/T3-37.md, "Matching an address in any spelling"). Pure
// functions, no process and no network: they classify a serial, read the device's addresses out of adb's texts, put an
// address into one canonical form, and replace the address tokens of a text that stand for one of a set of addresses.
// `scripts/tv-adb.mjs` is the only caller that starts adb.

export const STAND_IN = "[device]";

const IPV4 = /^\d{1,4}(?:\.\d{1,4}){3}$/;

/** The canonical key of an address text: `4:a.b.c.d`, `6:<url form>`, or null when it is no address. */
export function canonicalAddress(text) {
  const bare = text.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (IPV4.test(bare)) {
    // A part above 255 may be an octal part (`0300`), the way inet_aton reads it.
    const parts = bare.split(".").map((part) => (Number(part) <= 255 ? Number(part) : /^0[0-7]{1,3}$/.test(part) ? Number.parseInt(part, 8) : 256));
    return parts.every((part) => part <= 255) ? `4:${parts.join(".")}` : null;
  }
  if ((bare.match(/:/g) ?? []).length < 2) return null;
  let host;
  try {
    host = new URL(`http://[${bare}]/`).hostname;
  } catch {
    return null;
  }
  const inner = host.slice(1, -1);
  // An IPv4-mapped IPv6 address names the IPv4 address.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);
  if (mapped !== null) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return `4:${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `6:${inner}`;
}

/** An address no output needs hidden: loopback and unspecified. */
function isPlainAddress(key) {
  if (key === null) return true;
  if (key.startsWith("4:")) return key.startsWith("4:127.") || key === "4:0.0.0.0";
  return key === "6:::1" || key === "6:::";
}

const MDNS = /^(adb-[^.\s]+)\._adb-tls-[a-z]+\._tcp\.?$/i;
const BRACKETED = /^\[([^\]]+)\](?::(\d{1,5}))?$/;
const HOST_AND_PORT = /^([A-Za-z0-9._-]+?)(?::(\d{1,5}))?$/;

/** `emulator`, `address`, `mdns`, `host` or `other` (a USB-style serial), by the rules `serialForms` reads a serial with. */
export function serialKind(serial) {
  if (/^emulator-\d+$/.test(serial)) return "emulator";
  if (MDNS.test(serial)) return "mdns";
  const bracketed = BRACKETED.exec(serial);
  if (bracketed !== null) return canonicalAddress(bracketed[1]) === null ? "other" : "address";
  if ((serial.match(/:/g) ?? []).length >= 2) return canonicalAddress(serial) === null ? "other" : "address";
  const hostAndPort = HOST_AND_PORT.exec(serial);
  if (hostAndPort === null) return "other";
  const [, host, port] = hostAndPort;
  if (IPV4.test(host)) return canonicalAddress(host) === null ? "other" : "address";
  return port !== undefined || host.includes(".") ? "host" : "other";
}

/** The serial's own address (an `address` serial, not loopback), as a one-element list, or an empty one. */
export function ownAddresses(serial) {
  if (serialKind(serial) !== "address") return [];
  const bracketed = BRACKETED.exec(serial);
  const host = bracketed !== null ? bracketed[1] : (serial.match(/:/g) ?? []).length >= 2 ? serial : serial.replace(/:\d+$/, "");
  return isPlainAddress(canonicalAddress(host)) ? [] : [host];
}

/** The host name of a `host` serial, without its port. */
export function hostName(serial) {
  return serial.replace(/:\d+$/, "");
}

/** The instance part (`adb-<id>`) of an mDNS serial. */
export function mdnsInstance(serial) {
  return MDNS.exec(serial)?.[1] ?? "";
}

const keepable = (address) => !isPlainAddress(canonicalAddress(address));

/** The non-loopback addresses `ip -o addr show` lists (every `inet` and `inet6`, prefix length and zone cut off). */
export function parseIpAddresses(text) {
  const found = [];
  for (const match of text.matchAll(/\binet6?\s+([0-9A-Fa-f:.]+)(?:%\S+)?(?:\/\d+)?/g)) {
    if (keepable(match[1])) found.push(match[1]);
  }
  return found;
}

/** The address of each line of `adb mdns services` whose first field is the serial's instance. */
export function parseMdnsAddresses(text, instance) {
  const found = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 3 || fields[0].toLowerCase() !== instance.toLowerCase()) continue;
    const endpoint = fields[fields.length - 1];
    const bracketed = BRACKETED.exec(endpoint);
    const address = bracketed !== null ? bracketed[1] : (endpoint.match(/:/g) ?? []).length >= 2 ? endpoint : endpoint.replace(/:\d+$/, "");
    if (keepable(address)) found.push(address);
  }
  return found;
}

/** The addresses a resolver answered (`dns.lookup` with `all`), without loopback. */
export function resolverAddresses(answers) {
  return answers.map((answer) => answer.address).filter(keepable);
}

// An address token, longest first: an address in brackets, then a run of hex digits, colons and dots.
const IPV6_TOKEN = /\[([0-9A-Fa-f:.]+)(?:%[^\]\s]*)?\]|([0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*)(?:%[A-Za-z0-9_]+)?/g;
const IPV4_TOKEN = /(?<!\d)(?<!\d\.)\d{1,4}(?:\.\d{1,4}){3}(?!\d)(?!\.\d)/g;

// The longest piece of a run that is a wanted address. A piece starts at the run's start or beside a colon and ends at the
// run's end or beside a colon or dot, so a `<hex>:` prefix, a `:<port>` suffix and trailing punctuation are cut off.
function addressIn(run, keys) {
  const starts = new Set([0]);
  const ends = new Set([run.length]);
  for (let i = 0; i < run.length; i += 1) {
    if (run[i] === ":") {
      starts.add(i);
      starts.add(i + 1);
    }
    if (run[i] === ":" || run[i] === ".") {
      ends.add(i);
      ends.add(i + 1);
    }
  }
  let best = null;
  for (const start of starts) {
    for (const end of ends) {
      if (end <= start || (best !== null && end - start <= best.end - best.start)) continue;
      const key = canonicalAddress(run.slice(start, end));
      if (key !== null && keys.has(key)) best = { start, end };
    }
  }
  return best;
}

// `run` with each wanted address piece replaced; `reachedEnd` says the last piece ran to the end of the run.
function redactRun(run, keys) {
  const found = addressIn(run, keys);
  if (found === null) return { text: run, reachedEnd: false };
  const before = redactRun(run.slice(0, found.start), keys).text;
  const after = redactRun(run.slice(found.end), keys);
  return { text: `${before}${STAND_IN}${after.text}`, reachedEnd: found.end === run.length || after.reachedEnd };
}

/** `text` with every address token that stands for one of `addresses`, in any spelling, replaced by `[device]`. */
export function redactAddresses(text, addresses) {
  const keys = new Set(addresses.map(canonicalAddress).filter((key) => key !== null));
  if (keys.size === 0) return text;
  const withoutV6 = text.replace(IPV6_TOKEN, (token, bracketed, run) => {
    if (bracketed !== undefined) return keys.has(canonicalAddress(bracketed) ?? "") ? STAND_IN : token;
    const redacted = redactRun(run, keys);
    if (redacted.text === run) return token;
    return `${redacted.text}${redacted.reachedEnd ? "" : token.slice(run.length)}`;
  });
  return withoutV6.replace(IPV4_TOKEN, (token) => (keys.has(canonicalAddress(token) ?? "") ? STAND_IN : token));
}
