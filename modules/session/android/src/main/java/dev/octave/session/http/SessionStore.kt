package dev.octave.session.http

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.security.MessageDigest

// The stored credential (decision 0005; docs/specs/T4-05.md, D1 to D3): one record per account at
// <root>/octave-sessions/<name>, <name> the lower-case hex SHA-256 of "<serverId>\n<userId>". A record is the version
// byte 0x01 and what the cipher sealed, with <name> as the associated data, so a record copied under another name does
// not open. The plaintext is UTF-8 JSON with exactly server, deviceId, token, userId, serverId and an optional userName.
//
// Every call that writes, deletes or reads a record runs under LOCK, which SessionTransport holds. Nothing here logs,
// and no answer carries a message.
internal class SessionStore(root: File, private val cipher: RecordCipher) {
    val dir: File = File(root, DIR)

    fun fileFor(serverId: String, userId: String): File = File(dir, nameFor(serverId, userId))

    fun owns(file: File): Boolean = file.parentFile?.path == dir.path

    // Writes the record through a synced temporary file renamed over it. Answers the record's file, or null when nothing
    // was stored (the cipher was unavailable, or the file could not be written); a record already there is then untouched.
    fun save(session: StoredSession): File? {
        val file = fileFor(session.serverId, session.userId)
        val plain = session.plaintext()
        val sealed = try {
            cipher.seal(plain, file.name.toByteArray(Charsets.UTF_8))
        } finally {
            plain.fill(0)
        }
        if (sealed !is RecordCipher.Sealed.Bytes) return null
        if (!dir.isDirectory && !dir.mkdirs()) return null
        val temporary = File(dir, file.name + TEMPORARY)
        val written = try {
            FileOutputStream(temporary).use { out ->
                out.write(VERSION.toInt())
                out.write(sealed.bytes)
                out.fd.sync()
            }
            temporary.renameTo(file)
        } catch (_: IOException) {
            false
        }
        if (written) return file
        forget(temporary)
        return null
    }

    // The record files, after removing any temporary file a save left behind.
    fun records(): List<File> {
        val files = dir.listFiles() ?: return emptyList()
        files.filter { isTemporaryName(it.name) }.forEach { forget(it) }
        return files.filter { isRecordName(it.name) && it.isFile }
    }

    // Classified from the bytes read, not from File.length(), which also answers 0 when the file cannot be reached
    // (G-L5): a read that fails is unavailable, and only bytes that were read can make a record corrupt.
    fun read(file: File): Read {
        val bytes = try {
            readAtMost(file, MAX_BYTES + 1)
        } catch (_: IOException) {
            return Read.Unavailable
        } catch (_: SecurityException) {
            return Read.Unavailable
        }
        if (bytes.size < MIN_BYTES || bytes.size > MAX_BYTES || bytes[0] != VERSION) return Read.Corrupt
        val opened = cipher.open(bytes.copyOfRange(1, bytes.size), file.name.toByteArray(Charsets.UTF_8))
        return when (opened) {
            RecordCipher.Opened.Corrupt -> Read.Corrupt
            RecordCipher.Opened.Unavailable -> Read.Unavailable
            is RecordCipher.Opened.Plain -> try {
                StoredSession.parse(opened.bytes)?.takeIf { nameFor(it.serverId, it.userId) == file.name }?.let { Read.Session(it) } ?: Read.Corrupt
            } finally {
                opened.bytes.fill(0)
            }
        }
    }

    private fun readAtMost(file: File, limit: Int): ByteArray = java.io.FileInputStream(file).use { input ->
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (out.size() < limit) {
            val count = input.read(buffer, 0, minOf(buffer.size, limit - out.size()))
            if (count < 0) break
            out.write(buffer, 0, count)
        }
        out.toByteArray()
    }

    override fun toString(): String = "SessionStore([redacted])"

    sealed interface Read {
        object Corrupt : Read

        object Unavailable : Read

        class Session(val session: StoredSession) : Read {
            override fun toString(): String = "Read.Session([redacted])"
        }
    }

    companion object {
        // The one process-wide lock over save, forget and restore (D3). The registry is process-wide and a new module
        // instance builds a new transport, so the lock cannot belong to a transport.
        val LOCK = Any()

        const val DIR = "octave-sessions"
        private const val VERSION: Byte = 1
        private const val TEMPORARY = ".tmp"
        private const val IV_AND_TAG = 12 + 16
        private const val MIN_BYTES = 1 + IV_AND_TAG
        private const val MAX_BYTES = 64 * 1024
        private val NAME = Regex("^[0-9a-f]{64}$")

        fun nameFor(serverId: String, userId: String): String =
            MessageDigest.getInstance("SHA-256").digest("$serverId\n$userId".toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it.toInt() and 0xff) }

        fun isRecordName(name: String): Boolean = NAME.matches(name)

        private fun isTemporaryName(name: String): Boolean = name.endsWith(TEMPORARY) && isRecordName(name.removeSuffix(TEMPORARY))

        // Deletes a record, needing no store and no cipher. A delete that fails is followed by a truncate to no bytes
        // and a second delete, so a file left behind holds no token and reads as corrupt at the next restore.
        fun forget(file: File) {
            if (file.delete() || !file.exists()) return
            try {
                RandomAccessFile(file, "rw").use { it.setLength(0) }
            } catch (_: IOException) {
                // Nothing more can be done here; the next restore tries again.
            } catch (_: SecurityException) {
                // As above.
            }
            file.delete()
        }
    }
}

// What one record holds. Only Kotlin builds or reads one; toString is redacted.
internal class StoredSession(
    val server: String,
    val deviceId: String,
    val token: String,
    val userId: String,
    val serverId: String,
    val userName: String?,
) {
    fun plaintext(): ByteArray = buildJsonObject {
        put("server", server)
        put("deviceId", deviceId)
        put("token", token)
        put("userId", userId)
        put("serverId", serverId)
        userName?.let { put("userName", it) }
    }.toString().toByteArray(Charsets.UTF_8)

    override fun toString(): String = "StoredSession([redacted])"

    companion object {
        private val REQUIRED = setOf("server", "deviceId", "token", "userId", "serverId")
        private val FIELDS = REQUIRED + "userName"

        // The record's JSON, or null for anything else: another field, a field that is not a string, an empty required
        // field, or an address ServerAddress refuses.
        fun parse(plain: ByteArray): StoredSession? {
            val element = try {
                Json.parseToJsonElement(String(plain, Charsets.UTF_8))
            } catch (_: Exception) {
                return null
            }
            val record = element as? JsonObject ?: return null
            if (!FIELDS.containsAll(record.keys) || !record.keys.containsAll(REQUIRED)) return null
            val fields = record.mapValues { (_, value) -> (value as? JsonPrimitive)?.takeIf { it.isString }?.content }
            if (fields.values.any { it == null } || REQUIRED.any { fields[it].isNullOrEmpty() }) return null
            val server = fields.getValue("server").orEmpty()
            val parses = try {
                ServerAddress.parse(server)
                true
            } catch (_: Exception) {
                false
            }
            if (!parses) return null
            return StoredSession(
                server = server,
                deviceId = fields.getValue("deviceId").orEmpty(),
                token = fields.getValue("token").orEmpty(),
                userId = fields.getValue("userId").orEmpty(),
                serverId = fields.getValue("serverId").orEmpty(),
                userName = fields["userName"],
            )
        }
    }
}
