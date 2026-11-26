package dev.octave.session.http

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import mockwebserver3.MockResponse
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// Helpers for the T4-05 store tests (docs/specs/T4-05.md, D1 to D5). Every token, user, server id and address here is
// made up; servers listen on the literal 127.0.0.1, and other hosts are documentation or private ranges no server uses.
//
// Testing contract (the implementer builds to it)
// - `RecordCipher` (http/RecordCipher.kt) is
//     interface RecordCipher {
//         fun seal(plain: ByteArray, associated: ByteArray): RecordCipher.Sealed
//         fun open(sealed: ByteArray, associated: ByteArray): RecordCipher.Opened
//     }
//   with `RecordCipher.Sealed.Bytes(bytes)` and the object `RecordCipher.Sealed.Unavailable`, and
//   `RecordCipher.Opened.Plain(bytes)` and the objects `RecordCipher.Opened.Corrupt` and `RecordCipher.Opened.Unavailable`.
//   What `seal` answers is the 12-byte IV followed by the ciphertext and its 16-byte tag; `open` takes the same bytes.
// - `SessionStore(root: File, cipher: RecordCipher)` (http/SessionStore.kt) keeps each record at
//   `<root>/octave-sessions/<name>`, `<name>` the lower-case hex SHA-256 of "<serverId>\n<userId>" (UTF-8). A record is
//   the version byte 0x01, then what `seal` answered; the associated data is `<name>` in UTF-8. The plaintext is UTF-8
//   JSON with exactly `server`, `deviceId`, `token`, `userId`, `serverId`, and `userName` when the sign-in named one.
// - `SessionTransport(identity, servers, store)`: the store is a third, defaulted parameter. `restore()` takes nothing and
//   answers `{ "sessions": [ { session, server, deviceId, userId, serverId, userName? } ] }`.
internal object StoreTestSupport {
    const val DEVICE_ID = "t405-device-0001"
    val identity: ClientIdentity = ClientIdentity.of("Octave Test TV", "0.0.0")
    val release: DevelopmentServers = DevelopmentServers.forBuild(false, "")

    fun recordName(serverId: String, userId: String): String =
        MessageDigest.getInstance("SHA-256").digest("$serverId\n$userId".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    fun recordsDir(root: File): File = File(root, "octave-sessions")

    fun recordFile(root: File, serverId: String, userId: String): File = File(recordsDir(root), recordName(serverId, userId))

    // The plaintext a record holds, as D1 lists it.
    fun plaintext(server: String, token: String, userId: String, serverId: String?, userName: String? = null, deviceId: String = DEVICE_ID): String {
        val fields = linkedMapOf<String, JsonPrimitive>(
            "server" to JsonPrimitive(server),
            "deviceId" to JsonPrimitive(deviceId),
            "token" to JsonPrimitive(token),
            "userId" to JsonPrimitive(userId),
        )
        if (serverId != null) fields["serverId"] = JsonPrimitive(serverId)
        if (userName != null) fields["userName"] = JsonPrimitive(userName)
        return JsonObject(fields).toString()
    }

    // Writes a record the way D1 lays it out, sealed by `cipher` under `name`.
    fun plantRecord(root: File, cipher: GcmTestCipher, name: String, plain: String): File {
        val dir = recordsDir(root)
        dir.mkdirs()
        val file = File(dir, name)
        file.writeBytes(byteArrayOf(1) + cipher.sealRaw(plain.toByteArray(Charsets.UTF_8), name.toByteArray(Charsets.UTF_8)))
        return file
    }

    // The JSON a Jellyfin sign-in answers with. `serverId` null leaves ServerId out.
    fun signInAnswer(token: String, userId: String, serverId: String?, name: String? = "Fixture Viewer"): MockResponse {
        val user = buildString {
            append("{\"Id\":\"").append(userId).append('"')
            if (name != null) append(",\"Name\":\"").append(name).append('"')
            append('}')
        }
        val server = if (serverId == null) "" else ",\"ServerId\":\"$serverId\""
        return MockResponse.Builder()
            .code(200)
            .addHeader("Content-Type", "application/json")
            .body("{\"AccessToken\":\"$token\",\"User\":$user$server}")
            .build()
    }

    fun passwordArgs(server: String): Map<String, Any?> = mapOf(
        "server" to server,
        "deviceId" to DEVICE_ID,
        "kind" to "password",
        "username" to "fixture-viewer",
        "password" to "fixture-password",
        "timeoutMs" to 5_000.0,
    )

    @Suppress("UNCHECKED_CAST")
    fun sessionsOf(result: Map<String, Any?>): List<Map<String, Any?>> {
        val sessions = result["sessions"]
        check(sessions is List<*>) { "restore() answered no sessions list: ${result.keys}" }
        return sessions.map { it as Map<String, Any?> }
    }

    fun tempRoot(prefix: String): File = Files.createTempDirectory(prefix).toFile()
}

// A real AES-256-GCM cipher with a key the test holds, standing in for the Keystore's (D2, D3).
internal class GcmTestCipher(val key: ByteArray = randomKey()) : RecordCipher {
    fun sealRaw(plain: ByteArray, associated: ByteArray): ByteArray {
        val iv = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(associated)
        return iv + cipher.doFinal(plain)
    }

    fun openRaw(sealed: ByteArray, associated: ByteArray): ByteArray? {
        if (sealed.size < 12 + 16) return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
        cipher.updateAAD(associated)
        return try {
            cipher.doFinal(sealed.copyOfRange(12, sealed.size))
        } catch (_: AEADBadTagException) {
            null
        }
    }

    override fun seal(plain: ByteArray, associated: ByteArray): RecordCipher.Sealed = RecordCipher.Sealed.Bytes(sealRaw(plain, associated))

    override fun open(sealed: ByteArray, associated: ByteArray): RecordCipher.Opened =
        openRaw(sealed, associated)?.let { RecordCipher.Opened.Plain(it) } ?: RecordCipher.Opened.Corrupt

    companion object {
        private val random = SecureRandom()

        fun randomKey(): ByteArray = ByteArray(32).also { random.nextBytes(it) }
    }
}

// A cipher whose answers a test can switch: as the inner cipher, unavailable, or corrupt. `beforeOpen` and `beforeSeal`
// run on each call, so a test can hold one while another thread runs.
internal class SwitchCipher(val inner: GcmTestCipher = GcmTestCipher()) : RecordCipher {
    enum class Mode { WORKING, UNAVAILABLE, CORRUPT }

    @Volatile var openMode: Mode = Mode.WORKING
    @Volatile var sealMode: Mode = Mode.WORKING
    @Volatile var beforeOpen: (ByteArray) -> Unit = {}
    @Volatile var beforeSeal: () -> Unit = {}
    val seals = java.util.concurrent.atomic.AtomicInteger()

    override fun seal(plain: ByteArray, associated: ByteArray): RecordCipher.Sealed {
        seals.incrementAndGet()
        beforeSeal()
        return when (sealMode) {
            Mode.WORKING -> inner.seal(plain, associated)
            Mode.UNAVAILABLE, Mode.CORRUPT -> RecordCipher.Sealed.Unavailable
        }
    }

    override fun open(sealed: ByteArray, associated: ByteArray): RecordCipher.Opened {
        beforeOpen(associated)
        return when (openMode) {
            Mode.WORKING -> inner.open(sealed, associated)
            Mode.UNAVAILABLE -> RecordCipher.Opened.Unavailable
            Mode.CORRUPT -> RecordCipher.Opened.Corrupt
        }
    }
}

// One app's data root, its store and the transports a test builds over it. `relaunch()` stands for a process death: the
// sessions this rig saw leave the process-wide registry, and nothing on disk changes.
internal class StoreRig(prefix: String, val cipher: SwitchCipher = SwitchCipher()) : AutoCloseable {
    val dataRoot: File = StoreTestSupport.tempRoot(prefix)
    val root: File = File(dataRoot, "no_backup").also { it.mkdirs() }
    val server = PathServer()
    private val seen = java.util.concurrent.CopyOnWriteArrayList<String>()

    fun store(cipher: RecordCipher = this.cipher): SessionStore = SessionStore(root, cipher)

    fun transport(servers: DevelopmentServers = StoreTestSupport.release, cipher: RecordCipher = this.cipher): SessionTransport =
        SessionTransport(StoreTestSupport.identity, servers, store(cipher))

    // Signs in to the rig's server with the given answer and returns the result map.
    fun signIn(
        transport: SessionTransport,
        token: String,
        userId: String,
        serverId: String?,
        name: String? = "Fixture Viewer",
        base: String = server.origin,
    ): Map<String, Any?> {
        server.answer(base.removePrefix(server.origin) + "/Users/AuthenticateByName") { StoreTestSupport.signInAnswer(token, userId, serverId, name) }
        val result = transport.signIn(StoreTestSupport.passwordArgs(base))
        (result["session"] as? String)?.let { seen.add(it) }
        return result
    }

    fun signedIn(transport: SessionTransport, token: String, userId: String, serverId: String?, name: String? = "Fixture Viewer"): String {
        val result = signIn(transport, token, userId, serverId, name)
        return checkNotNull(result["session"] as? String) { "the sign-in failed: ${result["error"]}" }
    }

    fun restore(transport: SessionTransport): List<Map<String, Any?>> {
        val sessions = StoreTestSupport.sessionsOf(transport.restore())
        sessions.forEach { entry -> (entry["session"] as? String)?.let { seen.add(it) } }
        return sessions
    }

    fun restoredFor(transport: SessionTransport, userId: String): List<Map<String, Any?>> = restore(transport).filter { it["userId"] == userId }

    fun relaunch() {
        for (id in seen) SessionId.parse(id)?.let { SessionRegistry.close(it) }
        seen.clear()
    }

    fun record(serverId: String, userId: String): File = StoreTestSupport.recordFile(root, serverId, userId)

    override fun close() {
        relaunch()
        server.close()
        dataRoot.walkBottomUp().forEach {
            it.setWritable(true)
            it.setReadable(true)
            it.setExecutable(true)
        }
        dataRoot.deleteRecursively()
    }
}
