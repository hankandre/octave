package dev.octave.session.http

import java.io.ByteArrayOutputStream

// The query parameter names Jellyfin, or a proxy in front of it, may read as a token: the set in
// packages/core/src/jellyfin/credential-query.ts, compared after decoding, trimming and lower-casing.
internal object CredentialQuery {
    val NAMES: Set<String> = setOf("apikey", "api_key", "access_token", "token", "x-emby-token", "apitoken", "accesstoken")

    // True when a query of the URL names a credential. `encodedQuery` is the query as written; names are decoded as
    // URLSearchParams decodes them (+ is a space), then trimmed as JavaScript trims and lower-cased.
    fun hasCredentialName(encodedQuery: String?): Boolean {
        if (encodedQuery == null) return false
        return encodedQuery.split('&').any { pair ->
            val name = pair.substringBefore('=')
            HostClassifier.jsTrim(PercentDecoding.decode(name.replace('+', ' '))).lowercase() in NAMES
        }
    }
}

// Percent-decoding that never throws: a % not followed by two hex digits stays as written, and bytes that are not
// UTF-8 become U+FFFD. + is left alone.
internal object PercentDecoding {
    fun decode(text: String): String {
        if (!text.contains('%')) return text
        val bytes = ByteArrayOutputStream(text.length)
        var index = 0
        while (index < text.length) {
            val char = text[index]
            if (char == '%' && index + 2 < text.length) {
                val high = Character.digit(text[index + 1], 16)
                val low = Character.digit(text[index + 2], 16)
                if (high >= 0 && low >= 0 && text[index + 1].code < 128 && text[index + 2].code < 128) {
                    bytes.write((high shl 4) or low)
                    index += 3
                    continue
                }
            }
            val end = if (Character.isHighSurrogate(char) && index + 1 < text.length) index + 2 else index + 1
            bytes.write(text.substring(index, end).toByteArray(Charsets.UTF_8))
            index = end
        }
        return String(bytes.toByteArray(), Charsets.UTF_8)
    }
}
