package dev.octave.session.http

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

// A session as the registry holds it: the pinned origin, the base path and the header value. Nothing outside http/
// can read one.
internal class SessionEntry(
    val scheme: String,
    val host: String,
    val port: Int,
    val authorization: MediaBrowserAuthorization,
    val basePath: String = "",
) {
    val address: ServerAddress get() = ServerAddress(scheme, host, port, basePath)

    override fun toString(): String = "SessionEntry([redacted])"
}

// The sessions this process holds, in memory only (decision 0005). The store is T4-05's.
object SessionRegistry {
    private val sessions = ConcurrentHashMap<SessionId, SessionEntry>()

    // Opens a session for a server address as the core hands it over. Throws OctaveHttpException.
    internal fun open(baseUrl: String, authorization: MediaBrowserAuthorization): SessionId {
        val address = ServerAddress.parse(baseUrl)
        val entry = SessionEntry(address.scheme, address.host, address.port, authorization, address.basePath)
        while (true) {
            val id = SessionId.random()
            if (sessions.putIfAbsent(id, entry) == null) return id
        }
    }

    internal fun close(session: SessionId) {
        sessions.remove(session)
    }

    // Removes the session and hands its entry to the one logout call (decision 0005: the entry goes first).
    internal fun take(session: SessionId): SessionEntry? = sessions.remove(session)

    internal fun entry(session: SessionId): SessionEntry? = sessions[session]

    // The number of sessions held; no id and no entry (T3-25, for the cap tests).
    internal fun count(): Int = sessions.size
}
