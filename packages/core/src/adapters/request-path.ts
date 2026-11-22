// The path rule of a server request (T3-16; docs/specs/T3-16.md, "The path rule"), the same rule Kotlin's
// RequestPath.isSafe applies before the native request builds anything. A path is safe only when all hold:
//   P1. It starts with / and not with //, and holds no ? or #.
//   P2. It holds no backslash.
//   P3. It holds no character below U+0020 and no U+007F.
//   P4. No segment is . or .., as written or after up to four rounds of percent-decoding, split on / and \.
//   P5. Every % begins two hex digits, and the escapes of the path as written decode to UTF-8.
// Both sides pass packages/core/tests/fixtures/request-paths.json.

const DECODING_ROUNDS = 4;
const ESCAPE_RUN = /(?:%[0-9A-Fa-f]{2})+/g;
const lenientUtf8 = new TextDecoder("utf-8");

// Percent-decoding that never throws, as Kotlin's PercentDecoding: a % not followed by two hex digits stays as
// written, and bytes that are not UTF-8 become U+FFFD.
function decodeLeniently(text: string): string {
  return text.replace(ESCAPE_RUN, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16);
    return lenientUtf8.decode(bytes);
  });
}

function hasDotSegment(text: string): boolean {
  return text.split(/[/\\]/).some((segment) => segment === "." || segment === "..");
}

export function isSafeRequestPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#]/.test(path)) return false;
  if (path.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  // P5: decodeURIComponent throws on a malformed escape and on bytes that are not UTF-8 (an overlong form included).
  try {
    decodeURIComponent(path);
  } catch {
    return false;
  }
  let text = path;
  for (let round = 0; round <= DECODING_ROUNDS; round += 1) {
    if (hasDotSegment(text)) return false;
    if (!text.includes("%")) break;
    text = decodeLeniently(text);
  }
  return true;
}
