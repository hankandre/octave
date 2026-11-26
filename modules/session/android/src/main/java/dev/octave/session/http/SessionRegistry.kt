package dev.octave.session.http

import java.io.File
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

// A session as the registry holds it: the pinned origin, the base path, the header value and, for a session with a
// stored record (T4-05), its account. Nothing outside http/ can read one.
internal class SessionEntry(
    val scheme: String,
    val host: String,
    val port: Int,
    val authorization: MediaBrowserAuthorization,
    val basePath: String = "",
    val account: SessionAccount? = null,
) {
    val address: ServerAddress get() = ServerAddress(scheme, host, port, basePath)

    override fun toString(): String = "SessionEntry([redacted])"
}

// The account of a session (docs/specs/T4-05.md, D3): what restoreSessions answers for it, and the record it names.
// `record` changes only under SessionStore.LOCK: it is set once the record is saved, and cleared when the session ends
// or a newer sign-in to the same account replaces the record, so ending this session never deletes a newer record.
internal class SessionAccount(
    val server: String,
    val deviceId: String,
    val userId: String,
    val serverId: String,
    val userName: String?,
    record: File? = null,
) {
    @Volatile
    var record: File? = record

    override fun toString(): String = "SessionAccount([redacted])"
}

// The sessions this process holds, in memory only (decision 0005); the encrypted records are SessionStore's.
object SessionRegistry {
    private val sessions = ConcurrentHashMap<SessionId, SessionEntry>()

    // Opens a session for a server address as the core hands it over. Throws OctaveHttpException.
    internal fun open(baseUrl: String, authorization: MediaBrowserAuthorization, account: SessionAccount? = null): SessionId {
        val address = ServerAddress.parse(baseUrl)
        val entry = SessionEntry(address.scheme, address.host, address.port, authorization, address.basePath, account)
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

    // Whether this process holds the session: the one answer another module gets (T8-01). No entry, origin or header.
    fun holds(session: SessionId): Boolean = sessions.containsKey(session)

    // The sessions that carry an account, for the store's checks and restoreSessions (T4-05).
    internal fun withAccounts(): List<Pair<SessionId, SessionEntry>> =
        sessions.entries.filter { it.value.account != null }.map { it.key to it.value }

    // The number of sessions held; no id and no entry (T3-25, for the cap tests).
    internal fun count(): Int = sessions.size
}
