// The path rule of a server request (T3-16, T3-24; docs/specs/T3-24.md, "The rule as built"), the same rule Kotlin's
// RequestPath.isSafe applies before the native request builds anything. Round 0 is the path as written; rounds 1 to 4
// are that text percent-decoded once more each time. A path is safe only when all hold:
//   P1. It starts with / and not with //, and holds no ? or #. Round 0 only.
//   P2. It holds no backslash. Round 0 only; a decoded \ still splits segments in P4.
//   P3. No round holds a control character: U+0000 to U+001F or U+007F to U+009F.
//   P4. In no round, split on / and \, is a segment . or .., or made only of . and dot-like characters with at least
//       one dot-like character. The nine dot-like characters: U+2024, U+2025, U+2026, U+3002, U+FE19, U+FE30, U+FE52,
//       U+FF0E, U+FF61. A segment of ASCII dots alone is refused only as . or .., so /Items/... is accepted.
//   P5. In round 0 every % begins two ASCII hex digits. In every round each maximal run of escapes decodes as UTF-8
//       (no overlong form, no encoded surrogate, nothing above U+10FFFF); in rounds 1 to 4 a % that begins no escape
//       is a literal, so /Items/100%25 is accepted.
//   P6. No round holds a ;.
//   P7. Round 4 holds no escape (% and two hex digits): a path still encoded after four rounds is refused.
// Limits: the dot-like list is a list, so a proxy that folds another character to a dot is not covered, and characters
// that fold to a separator or a ; (U+FF0F, U+FF3C, U+FF1B, U+FE54, U+037E) pass this rule (tasks/backlog.jsonl). An id
// holding a literal % and two hex digits that are not UTF-8 (50%ff, sent as %25ff) is refused by P5. The query string
// is not judged here. Both sides pass packages/core/tests/fixtures/request-paths.json. After P5 passes a round every
// escape run is UTF-8, so both sides decode a passing text the same way.

const DECODING_ROUNDS = 4;
const ESCAPE_RUN = /(?:%[0-9A-Fa-f]{2})+/g;
const ESCAPE = /%[0-9A-Fa-f]{2}/;
const BARE_PERCENT = /%(?![0-9A-Fa-f]{2})/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// P4's dot-like characters, the same list as RequestPath.kt.
const DOT_LIKE = "․‥…。︙︰﹒．｡";

const isDotLike = (char: string) => DOT_LIKE.includes(char);

// Decodes each maximal run of escapes as UTF-8 and keeps every other character, a % that begins no escape included.
// Null when a run is not UTF-8 (P5).
function decodeEscapeRuns(text: string): string | null {
  try {
    return text.replace(ESCAPE_RUN, (run) => decodeURIComponent(run));
  } catch {
    return null;
  }
}

function hasDotSegment(text: string): boolean {
  return text.split(/[/\\]/).some((segment) => {
    if (segment === "." || segment === "..") return true;
    const chars = [...segment];
    return chars.every((char) => char === "." || isDotLike(char)) && chars.some(isDotLike);
  });
}

export function isSafeRequestPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#]/.test(path)) return false;
  if (path.includes("\\")) return false;
  if (BARE_PERCENT.test(path)) return false;
  let text = path;
  for (let round = 0; round <= DECODING_ROUNDS; round += 1) {
    if (CONTROL.test(text)) return false;
    if (text.includes(";")) return false;
    const decoded = decodeEscapeRuns(text);
    if (decoded === null) return false;
    if (hasDotSegment(text)) return false;
    if (!text.includes("%")) return true;
    if (round === DECODING_ROUNDS) return !ESCAPE.test(text);
    text = decoded;
  }
  return true;
}
