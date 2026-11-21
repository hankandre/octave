package dev.octave.session.http

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

// An opaque session id: 128 random bits as 32 lower-case hex digits. Parsing an id grants nothing; authority is a
// registry entry, which only SessionRegistry.open makes.
class SessionId private constructor(val value: String) {
    override fun equals(other: Any?): Boolean = other is SessionId && other.value == value

    override fun hashCode(): Int = value.hashCode()

    override fun toString(): String = "SessionId([redacted])"

    companion object {
        private val SHAPE = Regex("^[0-9a-f]{32}$")
        private val random = SecureRandom()

        // Exactly 32 lower-case hex digits, else null.
        fun parse(text: String): SessionId? = if (SHAPE.matches(text)) SessionId(text) else null

        internal fun random(): SessionId {
            val bytes = ByteArray(16)
            random.nextBytes(bytes)
            return SessionId(bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) })
        }
    }
}

// A session as the registry holds it: the pinned origin and the header value. Nothing outside http/ can read one.
internal class SessionEntry(val scheme: String, val host: String, val port: Int, val authorization: MediaBrowserAuthorization) {
    override fun toString(): String = "SessionEntry([redacted])"
}

// The sessions this process holds, in memory only (decision 0005). The store is T4-05's.
object SessionRegistry {
    private val sessions = ConcurrentHashMap<SessionId, SessionEntry>()

    // Opens a session for a server address as the core hands it over. Throws OctaveHttpException.
    internal fun open(baseUrl: String, authorization: MediaBrowserAuthorization): SessionId {
        val entry = entryFor(baseUrl, authorization)
        while (true) {
            val id = SessionId.random()
            if (sessions.putIfAbsent(id, entry) == null) return id
        }
    }

    internal fun close(session: SessionId) {
        sessions.remove(session)
    }

    internal fun entry(session: SessionId): SessionEntry? = sessions[session]

    private fun entryFor(baseUrl: String, authorization: MediaBrowserAuthorization): SessionEntry {
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
        return SessionEntry(url.scheme, url.host, url.port, authorization)
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
