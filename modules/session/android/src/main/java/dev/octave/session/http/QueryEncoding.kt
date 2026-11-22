package dev.octave.session.http

// The reference adapter's query encoding, byte for byte (packages/core/src/adapters/fetch-transport.ts, encodeQuery,
// pinned by packages/core/tests/fixtures/transport-query-encoding.json): encodeURIComponent, then `:`, `$` and `,`
// left bare and a space written `+`. OkHttp then writes a `'` in a query as %27 and changes nothing else
// (QueryEncodingTest).
internal object QueryEncoding {
    fun encodePart(text: String): String =
        MediaBrowserHeader.encodeUriComponent(text)
            .replace("%3A", ":")
            .replace("%24", "$")
            .replace("%2C", ",")
            .replace("%20", "+")

    // null for no pairs, so the URL has no `?`.
    fun encode(pairs: List<Pair<String, String>>): String? =
        if (pairs.isEmpty()) null else pairs.joinToString("&") { (name, value) -> "${encodePart(name)}=${encodePart(value)}" }
}
