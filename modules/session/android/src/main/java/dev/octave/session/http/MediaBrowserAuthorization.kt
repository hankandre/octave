package dev.octave.session.http

// A session's Authorization value, accepted only in the exact shape MediaBrowserHeader.build writes:
//
//   MediaBrowser Client="V*", Device="V*", DeviceId="V*", Version="V*", Token="V+"
//
// where V is one of A-Z a-z 0-9 - _ . ! ~ * ' ( ) or % and two upper-case hex digits (what encodeURIComponent
// writes), and the whole value is at most MAX_BYTES UTF-8 bytes. The value is never logged, has no public accessor,
// and its debug form is redacted. parse is a hand-written scan, not a regular expression: java.util.regex recurses
// per repetition of an alternation and can overflow a small stack on a long value; parse returns null, never throws.
class MediaBrowserAuthorization private constructor(private val value: String, private val writtenToken: String) {
    // The header value, for the interceptor only.
    internal fun headerValue(): String = value

    // The token as the header writes it (percent-encoded) and decoded, for the token-in-URL refusal.
    internal fun tokenForms(): List<String> = listOf(writtenToken, PercentDecoding.decode(writtenToken)).distinct()

    // The token as the header writes it, for TokenStrip.
    internal fun writtenToken(): String = writtenToken

    override fun toString(): String = "MediaBrowserAuthorization([redacted])"

    companion object {
        const val MAX_BYTES: Int = 4096

        private const val PREFIX = "MediaBrowser "
        private val FIELDS = listOf("Client", "Device", "DeviceId", "Version", "Token")

        // null when the value is not accepted.
        fun parse(value: String): MediaBrowserAuthorization? {
            // Every accepted character is ASCII, so a value with more chars than MAX_BYTES has more bytes too.
            if (value.length > MAX_BYTES) return null
            if (!value.startsWith(PREFIX)) return null
            var index = PREFIX.length
            var token = ""
            for ((position, field) in FIELDS.withIndex()) {
                if (position > 0) {
                    if (!value.startsWith(", ", index)) return null
                    index += 2
                }
                val opening = "$field=\""
                if (!value.startsWith(opening, index)) return null
                index += opening.length
                val start = index
                index = scanValue(value, index)
                if (index >= value.length || value[index] != '"') return null
                if (field == "Token") {
                    if (index == start) return null
                    token = value.substring(start, index)
                }
                index += 1
            }
            if (index != value.length) return null
            if (value.toByteArray(Charsets.UTF_8).size > MAX_BYTES) return null
            return MediaBrowserAuthorization(value, token)
        }

        // Returns the index of the first character after a run of V.
        private fun scanValue(value: String, from: Int): Int {
            var index = from
            while (index < value.length) {
                val char = value[index]
                index += when {
                    isUnreserved(char) -> 1
                    char == '%' && index + 2 < value.length && isUpperHex(value[index + 1]) && isUpperHex(value[index + 2]) -> 3
                    else -> return index
                }
            }
            return index
        }

        internal fun isUnreserved(char: Char): Boolean =
            char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char in "-_.!~*'()"

        private fun isUpperHex(char: Char): Boolean = char in '0'..'9' || char in 'A'..'F'
    }
}
