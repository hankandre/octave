package dev.octave.session.http

import dev.octave.session.http.StoreTestSupport.DEVICE_ID
import dev.octave.session.http.StoreTestSupport.recordName
import dev.octave.session.http.StoreTestSupport.recordsDir
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T4-05 item 1 (docs/specs/T4-05.md, D1 to D3): after a sign-in, native code stores one record per account, encrypted
// with AES-256-GCM under the cipher's key with the record's file name as associated data. A changed byte reads as
// corrupt; a sign-in whose answer names no server id stores nothing. The device half (the real Keystore) is the probe
// stage `stored-credential`, quoted at verify.
//
// T4-05 item 5 (D1, D3): the record lives only under the directory the store is given (the no-backup directory on the
// device); nothing is written anywhere else in the app's data.
//
// The testing contract is in StoreTestSupport.kt.
class StoredCredentialTest {
    private val rig = StoreRig("octave-t405-stored")

    @AfterEach
    fun close() = rig.close()

    private val token = "t405-fake-token-1a2b"
    private val userId = "user-stored-1"
    private val serverId = "0123456789abcdef0123456789abcd01"

    private fun files(dir: File): List<File> = if (!dir.isDirectory) emptyList() else dir.walkTopDown().filter { it.isFile }.toList()

    @Test
    fun record_a_sign_in_stores_one_record_that_opens_only_with_the_key_and_its_name() {
        val session = rig.signedIn(rig.transport(), token, userId, serverId, name = "Fixture Viewer")
        assertNotNull(SessionId.parse(session), "the sign-in answered a session id")

        val stored = files(recordsDir(rig.root))
        assertEquals(listOf(recordName(serverId, userId)), stored.map { it.name }, "one record, named for the server id and the user id")
        val bytes = stored.single().readBytes()
        assertEquals(1, bytes[0].toInt(), "the version byte")
        val sealed = bytes.copyOfRange(1, bytes.size)
        val name = stored.single().name.toByteArray(Charsets.UTF_8)

        val plain = rig.cipher.inner.openRaw(sealed, name)
        assertNotNull(plain, "the record opens with the cipher's key and its file name as associated data")
        val json = Json.parseToJsonElement(String(checkNotNull(plain), Charsets.UTF_8)).jsonObject
        assertEquals(setOf("server", "deviceId", "token", "userId", "serverId", "userName"), json.keys, "the plaintext's fields")
        assertEquals(rig.server.origin, json.getValue("server").jsonPrimitive.content)
        assertEquals(DEVICE_ID, json.getValue("deviceId").jsonPrimitive.content)
        assertEquals(token, json.getValue("token").jsonPrimitive.content)
        assertEquals(userId, json.getValue("userId").jsonPrimitive.content)
        assertEquals(serverId, json.getValue("serverId").jsonPrimitive.content)
        assertEquals("Fixture Viewer", json.getValue("userName").jsonPrimitive.content)

        assertNull(GcmTestCipher().openRaw(sealed, name), "another key does not open it")
        assertNull(rig.cipher.inner.openRaw(sealed, recordName(serverId, "someone-else").toByteArray(Charsets.UTF_8)), "another name does not open it")
    }

    @Test
    fun record_a_changed_byte_reads_as_corrupt_and_the_record_is_deleted() {
        rig.signedIn(rig.transport(), token, userId, serverId)
        val record = rig.record(serverId, userId)
        assertTrue(record.isFile, "the sign-in stored the record")
        rig.relaunch()

        val bytes = record.readBytes()
        bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 0x01).toByte()
        record.writeBytes(bytes)

        assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(), userId), "a corrupt record is not listed")
        assertFalse(record.exists(), "a corrupt record is deleted")
    }

    @Test
    fun record_a_sign_in_whose_answer_names_no_server_id_stores_nothing() {
        val result = rig.signIn(rig.transport(), token, userId, serverId = null)
        assertNotNull(result["session"] as? String, "the viewer is signed in for this launch: ${result["error"]}")
        assertEquals(emptyList<File>(), files(rig.root), "nothing is stored")
    }

    @Test
    fun record_a_new_sign_in_to_the_same_account_replaces_its_record() {
        rig.signedIn(rig.transport(), token, userId, serverId)
        val newer = "t405-fake-token-newer-3c4d"
        rig.signedIn(rig.transport(), newer, userId, serverId)

        val stored = files(recordsDir(rig.root))
        assertEquals(listOf(recordName(serverId, userId)), stored.map { it.name }, "still one record for the account")
        val bytes = stored.single().readBytes()
        val plain = checkNotNull(rig.cipher.inner.openRaw(bytes.copyOfRange(1, bytes.size), stored.single().name.toByteArray(Charsets.UTF_8)))
        assertEquals(newer, Json.parseToJsonElement(String(plain, Charsets.UTF_8)).jsonObject.getValue("token").jsonPrimitive.content)
    }

    @Test
    fun record_two_accounts_keep_two_records() {
        rig.signedIn(rig.transport(), token, userId, serverId)
        rig.signedIn(rig.transport(), "t405-fake-token-other-5e6f", "user-stored-2", serverId)
        assertEquals(
            setOf(recordName(serverId, userId), recordName(serverId, "user-stored-2")),
            files(recordsDir(rig.root)).map { it.name }.toSet(),
        )
    }

    @Test
    fun no_file_outside_the_store_s_directory_after_sign_in_and_restore() {
        val siblings = listOf("files", "shared_prefs", "cache", "databases").map { File(rig.dataRoot, it).also { dir -> dir.mkdirs() } }
        rig.signedIn(rig.transport(), token, userId, serverId)
        rig.relaunch()
        val restored = rig.restoredFor(rig.transport(), userId)
        assertEquals(1, restored.size, "the account was restored")

        val outside = files(rig.dataRoot).filterNot { it.canonicalPath.startsWith(rig.root.canonicalPath + File.separator) }
        assertEquals(emptyList<String>(), outside.map { it.relativeTo(rig.dataRoot).path }, "files outside the store's directory")
        for (dir in siblings) assertEquals(emptyList<File>(), files(dir), "${dir.name} stays empty")
        val inside = files(rig.root).map { it.relativeTo(rig.root).invariantSeparatorsPath }
        assertEquals(listOf("octave-sessions/${recordName(serverId, userId)}"), inside, "only the record, under octave-sessions, with no temporary file left")
    }

    @Test
    fun no_file_outside_the_store_s_directory_after_sign_out() {
        val session = rig.signedIn(rig.transport(), token, userId, serverId)
        rig.server.answer("/Sessions/Logout") { mockwebserver3.MockResponse(204) }
        assertEquals(emptyMap<String, Any?>(), rig.transport().endSession(mapOf("session" to session, "timeoutMs" to 5_000.0)))
        val left = files(rig.dataRoot)
        assertEquals(emptyList<String>(), left.map { it.relativeTo(rig.dataRoot).path }, "no file is left anywhere in the data root")
    }
}
