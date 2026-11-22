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

// Percent-decoding that never throws, for dot detection only: a % not followed by two hex digits stays as written; a
// run of escapes that is not UTF-8 keeps its ASCII bytes and turns every other byte into U+FFFD. It may differ from
// Kotlin's PercentDecoding in non-ASCII text next to a bad byte, never in a dot, a slash or a backslash.
function decodeLeniently(text: string): string {
  return text.replace(ESCAPE_RUN, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run.replace(/%([0-9A-Fa-f]{2})/g, (_escape, hex: string) => {
        const byte = Number.parseInt(hex, 16);
        return byte < 0x80 ? String.fromCharCode(byte) : "\uFFFD";
      });
    }
  });
}

function hasDotSegment(text: string): boolean {
  return text.split(/[/\\]/).some((segment) => segment === "." || segment === "..");
}

export function isSafeRequestPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#]/.test(path)) return false;
  if (path.includes("\\")) return false;
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
