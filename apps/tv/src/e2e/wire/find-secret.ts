// Finds a secret in any value that crosses the seam or reaches a log (T3-05 item 4): raw, percent-encoded one to four
// rounds, base64 and base64url (with and without padding), in any string or key at any depth. It returns true or
// false and never the secret or where it was. No import and no global (Hermes has no Buffer), so the device, the
// host judge and Node tests share it.
const ROUNDS = 4;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}

function base64(text: string): string {
  const bytes = utf8(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += BASE64[a >> 2] + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : BASE64[c & 63];
  }
  return out;
}

// Every form of a secret to look for. Percent-encoding uses encodeURIComponent, upper- and lower-case hex.
export function secretForms(secret: string): string[] {
  const forms = new Set<string>([secret]);
  let encoded = secret;
  for (let round = 0; round < ROUNDS; round += 1) {
    encoded = encodeURIComponent(encoded);
    forms.add(encoded);
    forms.add(encoded.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()));
  }
  const padded = base64(secret);
  const bare = padded.replace(/=+$/, "");
  forms.add(padded);
  forms.add(bare);
  forms.add(bare.replace(/\+/g, "-").replace(/\//g, "_"));
  return [...forms].filter((form) => form !== "");
}

export function findSecret(value: unknown, secrets: readonly string[]): boolean {
  const forms = secrets.filter((secret) => secret !== "").flatMap(secretForms);
  if (forms.length === 0) return false;
  const seen = new Set<unknown>();
  const visit = (node: unknown): boolean => {
    if (typeof node === "string") return forms.some((form) => node.includes(form));
    if (typeof node !== "object" || node === null || seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) return node.some(visit);
    return Object.entries(node).some(([key, entry]) => visit(key) || visit(entry));
  };
  return visit(value);
}
