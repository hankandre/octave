import { redactText, redactedErrorMessage } from "./redact";

const MAX_LENGTH = 300;
// Each pattern starts only at a token start (a lookbehind, not \b) so matching
// stays linear on long input.
const ADDRESS = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/(?:[^\s"')\[\]]*\[[^\]\s"')]*\])?(?:\[redacted\]|[^\s"')\]])*/gi;
const UNC_PATH = /\\\\[^\s"'),;]+/g;
const WINDOWS_PATH = /\b[A-Za-z]:[\\/][^\s"'),;]*/g;
const HOME_PATH = /~\/[^\s"'),;]*/g;
// Host forms (R2 to R6). Each alternative has its own token-start lookbehind,
// so the user info, zone and glued path rules can share one pass.
const H = String.raw`[0-9a-f]{1,4}`;
const IPV6_GROUPS = String.raw`${H}(?::${H}){0,6}`;
// Groups holding "::" (at least one group), or exactly eight groups.
const IPV6 = String.raw`(?:${IPV6_GROUPS}::(?:${IPV6_GROUPS})?|::${IPV6_GROUPS}|${H}(?::${H}){7})`;
const ZONE = String.raw`%[\w.~-]+`;
const END = String.raw`(?![\w]|\.\d)`;
const PORT = String.raw`(?::\d{1,5}${END})?`;
const NAME_LABEL = String.raw`[a-z0-9-]`;
// Measurement words that read as word:NNNN in player text, not as a host.
const LABEL_WORDS = "status|code|line|pts|dts|bitrate|fps|errno|aid|sid|vid";
// A name of three or more labels under a code namespace is not a host name.
const CODE_NAMESPACE = String.raw`(?:(?:java|javax|kotlin|kotlinx|android|androidx|dalvik|c2|omx)\.${NAME_LABEL}+|com\.google|dev\.octave)\.${NAME_LABEL}`;
const HOST_FORMS = [
  // R5: bracketed with a zone, bracketed with `::` or eight groups, any bracketed with a port.
  String.raw`\[[0-9a-f.]*:[0-9a-f:.]*${ZONE}\]${PORT}`,
  String.raw`\[(?=[0-9a-f:.]*[0-9a-f])(?:[0-9a-f:.]*::[0-9a-f:.]*|${H}(?::${H}){7})\]${PORT}`,
  String.raw`\[[0-9a-f:.%]+\]:\d{1,5}${END}`,
  // Bare IPv6, with an optional zone and port.
  String.raw`(?<![\w:.\[])${IPV6}(?:${ZONE})?(?::\d{1,5}(?![\w]|\.\d))?(?![\w]|\.\d|:\d)`,
  // IPv4.
  String.raw`(?<![\w.-])\d{1,3}(?:\.\d{1,3}){3}${PORT}${END}`,
  String.raw`(?<![\w.-])localhost:\d{1,5}${END}`,
  // A dotted name, unless it is a code namespace.
  String.raw`(?<![\w.-])(?!${CODE_NAMESPACE})(?:${NAME_LABEL}+\.)+[a-z]{2,}${PORT}(?![\w-]|\.\w)`,
  // R2: a single label with a two to five digit port.
  String.raw`(?<![\w.-])(?!(?:${LABEL_WORDS}):)[a-z]${NAME_LABEL}*:\d{2,5}${END}`,
].join("|");
const GLUED_PATH = String.raw`(?:\/[^\s"'),;]*)?`;
// user@ with no password counts only before a form above (R6).
const HOST = new RegExp(
  String.raw`(?:(?<![\w.-])[^\s@:"'()\[\]\/,;]{1,64}@)?(?:${HOST_FORMS})${GLUED_PATH}`,
  "gi",
);
// user:pass@host, the user info running to the last @ before whitespace.
const USER_INFO =
  /(?<![\w.:@%\/-])[^\s@:"'()\[\],;]{1,64}:[^\s]{0,256}@[^\s"'),;]+/g;
const POSIX_PATH = /(?<![\w:.\]\/])\/+[^\s/"'),;]+(?:\/[^\s/"'),;]*)*/g;

// The only way a player failure reason reaches the screen. Native errors carry
// third-party text, so beyond redaction this hides addresses and file paths.
export function safeReason(value: string): string {
  const text = redactText(value)
    .replace(ADDRESS, "[address]")
    .replace(UNC_PATH, "[path]")
    .replace(WINDOWS_PATH, "[path]")
    .replace(HOME_PATH, "[path]")
    .replace(USER_INFO, "[address]")
    .replace(HOST, "[address]")
    .replace(POSIX_PATH, "[path]")
    .trim();
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
}

// Reads any player failure (string, Error, or other) one way, through
// safeReason, and gives `fallback` when it has no text.
export function errorReason(error: unknown, fallback: string): string {
  const text = safeReason(redactedErrorMessage(error));
  return text ? text : fallback;
}
