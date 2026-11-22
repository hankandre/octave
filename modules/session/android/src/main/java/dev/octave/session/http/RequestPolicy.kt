package dev.octave.session.http

import okhttp3.Request

// The interceptor's checks, in order, as a pure function of the session entry and the request. The first refusal
// wins; null means the request may be sent with the session's header. Every refusal happens before anything is
// resolved, connected or sent.
internal object RequestPolicy {
    // Caller headers that carry a credential or name a host. Host, :authority, Forwarded and X-Forwarded-* would let a
    // virtual-host proxy route the session's header to another backend (OkHttp keeps a caller's Host and builds HTTP/2's
    // :authority from it); X-Emby-* and X-MediaBrowser-* carry Jellyfin credentials that would replace the session's.
    // Names are compared lower-cased.
    private val REFUSED_HEADERS = setOf("authorization", "proxy-authorization", "cookie", "cookie2", "host", "forwarded")
    private val REFUSED_HEADER_PREFIXES = listOf(":", "proxy-", "x-forwarded-", "x-emby-", "x-mediabrowser-")

    // How many rounds of percent-decoding the token search looks through (decision 0005, no_url_carries_the_token).
    private const val DECODING_ROUNDS = 4

    fun check(entry: SessionEntry?, request: Request): HttpRefusal? {
        // 1. No session for the call.
        if (entry == null) return HttpRefusal.NO_SESSION
        return checkOrigin(entry.scheme, entry.host, entry.port, entry.authorization.tokenForms(), request)
    }

    // Checks 2 to 6 against a pinned origin; tokens are the forms of the token the URL must not hold (none before
    // sign-in).
    private fun checkOrigin(scheme: String, host: String, port: Int, tokens: List<String>, request: Request): HttpRefusal? {
        // 2. A caller may not bring its own credential header or a header that names a host.
        if (request.headers.names().any { refusedHeader(it) }) return HttpRefusal.HEADER_NOT_ALLOWED
        val url = request.url
        // 3. User info, before the origin, so user info naming another origin is still a credential refusal.
        if (url.encodedUsername.isNotEmpty() || url.encodedPassword.isNotEmpty()) return HttpRefusal.CREDENTIAL_URL
        // 4. Scheme, host and port must be the session's.
        if (url.scheme != scheme || url.host != host || url.port != port) return HttpRefusal.OTHER_ORIGIN
        // 5. A credential query name, or the session's token anywhere in the URL.
        if (CredentialQuery.hasCredentialName(url.encodedQuery)) return HttpRefusal.CREDENTIAL_URL
        if (holdsToken(url.toString(), tokens)) return HttpRefusal.CREDENTIAL_URL
        // 6. Plain HTTP only to loopback and private LAN. Unreachable through open today; a guard against a later change.
        if (url.scheme == "http") {
            val parsed = HostClassifier.parseUrlHost(url.host)
            if (parsed == null || HostClassifier.classify(parsed) == HostClass.PUBLIC) return HttpRefusal.PUBLIC_HTTP
        }
        return null
    }

    // The routes a request may use without a session: packages/core/src/ports/transport.ts, PRE_SIGN_IN_ROUTES.
    val PRE_SIGN_IN_ROUTES: List<Pair<String, String>> = listOf(
        "GET" to "/System/Info/Public",
        "GET" to "/QuickConnect/Enabled",
        "POST" to "/QuickConnect/Initiate",
        "GET" to "/QuickConnect/Connect",
    )

    // The six calls decision 0005 lets the client make without a session, as method and path under the base path: the
    // four pre-sign-in routes and the two sign-in posts.
    val TOKENLESS_CALLS: List<Pair<String, String>> =
        PRE_SIGN_IN_ROUTES + listOf("POST" to "/Users/AuthenticateByName", "POST" to "/Users/AuthenticateWithQuickConnect")

    // The one call a Closing authority may make.
    val LOGOUT: Pair<String, String> = "POST" to "/Sessions/Logout"

    // A tokenless call: the same header, user-info, origin, credential-name and plain-HTTP rules as a session's, and
    // only one of the six tokenless calls under the address's base path.
    fun checkTokenless(address: ServerAddress, request: Request): HttpRefusal? {
        checkOrigin(address.scheme, address.host, address.port, emptyList(), request)?.let { return it }
        val call = request.method to request.url.encodedPath
        if (TOKENLESS_CALLS.none { (method, path) -> call == method to address.basePath + path }) return HttpRefusal.ROUTE_NOT_ALLOWED
        return null
    }

    // The logout of a removed session: the session's own rules, and only POST /Sessions/Logout under its base path.
    fun checkClosing(entry: SessionEntry, request: Request): HttpRefusal? {
        check(entry, request)?.let { return it }
        if (request.method to request.url.encodedPath != LOGOUT.first to entry.basePath + LOGOUT.second) return HttpRefusal.ROUTE_NOT_ALLOWED
        return null
    }

    private fun refusedHeader(name: String): Boolean {
        val lower = name.lowercase()
        return lower in REFUSED_HEADERS || REFUSED_HEADER_PREFIXES.any { lower.startsWith(it) }
    }

    private fun holdsToken(text: String, tokens: List<String>): Boolean {
        val forms = tokens.filter { it.isNotEmpty() }
        if (forms.any { text.contains(it) }) return true
        var decoded = text
        repeat(DECODING_ROUNDS) {
            decoded = PercentDecoding.decode(decoded)
            if (forms.any { decoded.contains(it) }) return true
        }
        return false
    }
}
