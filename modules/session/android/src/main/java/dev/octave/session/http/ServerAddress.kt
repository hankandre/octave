package dev.octave.session.http

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

// A server address as the core hands it over (decision 0005, amendment T2-04): scheme, host, port and a base path
// with no trailing slash ("" for none), never user info, a query or a fragment. It is the session's pinned origin and
// the tokenless calls' origin alike, so both pass the same checks (decision 0001; T3-03's SessionRegistry rules).
internal class ServerAddress(val scheme: String, val host: String, val port: Int, val basePath: String) {
    // The URL of a path under the base path, with an encoded query. Dot segments are resolved by OkHttp and are not
    // refused here (T3-16).
    fun url(path: String, encodedQuery: String?): HttpUrl = HttpUrl.Builder()
        .scheme(scheme)
        .host(host)
        .port(port)
        .encodedPath(basePath + path)
        .encodedQuery(encodedQuery)
        .build()

    override fun toString(): String = "ServerAddress([redacted])"

    companion object {
        // Throws OctaveHttpException.
        fun parse(baseUrl: String): ServerAddress {
            val written = HostClassifier.jsTrim(baseUrl)
            // 1. A plain-HTTP address whose class is public, before any other check, so every public vector gets this code.
            val plainHttp = written.length >= 5 && written.substring(0, 5).lowercase() == "http:"
            if (plainHttp && HostClassifier.classifyServerAddress(written) == HostClass.PUBLIC) refuse(HttpRefusal.PUBLIC_HTTP)
            // 2. R1 for https as well: a Unicode-written host would let the core and OkHttp disagree on the origin.
            if (!HostClassifier.hasPlainAsciiAuthority(written)) refuse(HttpRefusal.INVALID_ADDRESS)
            // 3. OkHttp must parse it, with no user info, query or fragment. A base path is kept; the pin is the origin.
            val url = written.toHttpUrlOrNull() ?: refuse(HttpRefusal.INVALID_ADDRESS)
            if (url.encodedUsername.isNotEmpty() || url.encodedPassword.isNotEmpty() || url.encodedQuery != null || url.encodedFragment != null) {
                refuse(HttpRefusal.INVALID_ADDRESS)
            }
            // 4. The host OkHttp dials must be the host the classifier read.
            val read = HostClassifier.parseServerHost(written) ?: refuse(HttpRefusal.INVALID_ADDRESS)
            if (!dialsTheHostRead(read, url)) refuse(HttpRefusal.INVALID_ADDRESS)
            return ServerAddress(url.scheme, url.host, url.port, url.encodedPath.trimEnd('/'))
        }

        private fun dialsTheHostRead(read: ParsedHost, url: HttpUrl): Boolean {
            val dialled = HostClassifier.parseUrlHost(url.host) ?: return false
            val same = when (read) {
                is ParsedHost.Ipv4 -> url.host == read.dotted
                is ParsedHost.Name -> url.host == read.name
                is ParsedHost.Ipv6 -> {
                    val mapped = read.mappedIpv4
                    if (mapped != null) {
                        url.host == mapped.dotted
                    } else {
                        dialled is ParsedHost.Ipv6 && dialled.groups.contentEquals(read.groups)
                    }
                }
            }
            return same && HostClassifier.classify(read) == HostClassifier.classify(dialled)
        }

        private fun refuse(refusal: HttpRefusal): Nothing = throw OctaveHttpException(refusal)
    }
}
