package dev.octave.session.http

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

// The path rule of the native request (T3-16, T3-24; docs/specs/T3-24.md, "The rule as built"). Round 0 is the path as
// written; rounds 1 to 4 are that text percent-decoded once more each time. A path is safe only when all hold:
//   P1. It starts with / and not with //. No round holds a ? or #, so a proxy that decodes once and then splits off a
//       query or fragment cannot cut /Items/..%3f/x down to /Items/.. (review fix).
//   P2. It holds no backslash (OkHttp reads \ as a separator). Round 0 only; a decoded \ still splits segments in P4.
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
// holding a literal % and two hex digits that are not UTF-8 (50%ff, sent as %25ff) is refused by P5, and an id holding
// a ? or # (sent as %3F or %23) by P1. The query string is not judged here. The core's reference transport applies
// the same rule (packages/core/src/adapters/request-path.ts); both pass the vectors of
// packages/core/tests/fixtures/request-paths.json. Containment beyond this is ServerAddress.url (C1) and RequestPolicy
// (C2), which runs holdsRefusedForm on the encoded path of every session and closing call.
internal object RequestPath {
    // As many rounds as the token search looks through (RequestPolicy).
    private const val DECODING_ROUNDS = 4

    // P4's dot-like characters, the same list as request-path.ts.
    private const val DOT_LIKE = "․‥…。︙︰﹒．｡"

    fun isSafe(path: String): Boolean {
        if (!path.startsWith("/") || path.startsWith("//")) return false
        return !holdsRefusedForm(path)
    }

    // P1's ? and #, and P2 to P7: true when the path holds a form the rule refuses.
    fun holdsRefusedForm(path: String): Boolean {
        if (path.contains('\\')) return true
        if (!percentsBeginEscapes(path)) return true
        var text = path
        for (round in 0..DECODING_ROUNDS) {
            if (text.any { isControl(it) }) return true
            if (text.contains(';')) return true
            if (text.contains('?') || text.contains('#')) return true
            val decoded = decodeEscapeRuns(text) ?: return true
            if (holdsDotSegment(text)) return true
            if (!text.contains('%')) return false
            if (round == DECODING_ROUNDS) return text.indices.any { escapeAt(text, it) }
            text = decoded
        }
        return false
    }

    private fun isControl(char: Char): Boolean = char < ' ' || char in '\u007f'..'\u009f'

    private fun isDotLike(char: Char): Boolean = DOT_LIKE.indexOf(char) >= 0

    private fun holdsDotSegment(text: String): Boolean =
        text.split('/', '\\').any { segment ->
            segment == "." || segment == ".." ||
                (segment.all { it == '.' || isDotLike(it) } && segment.any { isDotLike(it) })
        }

    private fun percentsBeginEscapes(text: String): Boolean =
        text.indices.all { text[it] != '%' || escapeAt(text, it) }

    // Decodes each maximal run of escapes as UTF-8 and keeps every other character, a % that begins no escape included.
    // Null when a run is not UTF-8 (P5).
    private fun decodeEscapeRuns(text: String): String? {
        if (!text.contains('%')) return text
        val out = StringBuilder(text.length)
        var index = 0
        while (index < text.length) {
            if (!escapeAt(text, index)) {
                out.append(text[index])
                index += 1
                continue
            }
            var end = index
            while (escapeAt(text, end)) end += 3
            val bytes = ByteArray((end - index) / 3) { i ->
                ((hexDigit(text[index + i * 3 + 1]) shl 4) or hexDigit(text[index + i * 3 + 2])).toByte()
            }
            val decoder = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            try {
                out.append(decoder.decode(ByteBuffer.wrap(bytes)))
            } catch (_: CharacterCodingException) {
                return null
            }
            index = end
        }
        return out.toString()
    }

    private fun escapeAt(text: String, index: Int): Boolean =
        index + 2 < text.length && text[index] == '%' && hexDigit(text[index + 1]) >= 0 && hexDigit(text[index + 2]) >= 0

    private fun hexDigit(char: Char): Int = when (char) {
        in '0'..'9' -> char - '0'
        in 'a'..'f' -> char - 'a' + 10
        in 'A'..'F' -> char - 'A' + 10
        else -> -1
    }
}
