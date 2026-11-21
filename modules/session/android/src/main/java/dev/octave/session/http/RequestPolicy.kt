package dev.octave.session.http

import okhttp3.Request

// The interceptor's checks, in order, as a pure function of the session entry and the request. The first refusal
// wins; null means the request may be sent with the session's header. Every refusal happens before anything is
// resolved, connected or sent.
internal object RequestPolicy {
    private val CREDENTIAL_HEADERS = listOf("Authorization", "Proxy-Authorization", "Cookie")

    // How many rounds of percent-decoding the token search looks through (decision 0005, no_url_carries_the_token).
    private const val DECODING_ROUNDS = 4

    fun check(entry: SessionEntry?, request: Request): HttpRefusal? {
        // 1. No session for the call.
        if (entry == null) return HttpRefusal.NO_SESSION
        // 2. A caller may not bring its own credential header.
        if (CREDENTIAL_HEADERS.any { request.header(it) != null }) return HttpRefusal.HEADER_NOT_ALLOWED
        val url = request.url
        // 3. User info, before the origin, so user info naming another origin is still a credential refusal.
        if (url.encodedUsername.isNotEmpty() || url.encodedPassword.isNotEmpty()) return HttpRefusal.CREDENTIAL_URL
        // 4. Scheme, host and port must be the session's.
        if (url.scheme != entry.scheme || url.host != entry.host || url.port != entry.port) return HttpRefusal.OTHER_ORIGIN
        // 5. A credential query name, or the session's token anywhere in the URL.
        if (CredentialQuery.hasCredentialName(url.encodedQuery)) return HttpRefusal.CREDENTIAL_URL
        if (holdsToken(url.toString(), entry.authorization.tokenForms())) return HttpRefusal.CREDENTIAL_URL
        // 6. Plain HTTP only to loopback and private LAN. Unreachable through open today; a guard against a later change.
        if (url.scheme == "http") {
            val host = HostClassifier.parseUrlHost(url.host)
            if (host == null || HostClassifier.classify(host) == HostClass.PUBLIC) return HttpRefusal.PUBLIC_HTTP
        }
        return null
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
