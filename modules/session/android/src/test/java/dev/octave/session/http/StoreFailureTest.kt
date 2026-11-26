package dev.octave.session.http

import dev.octave.session.http.StoreTestSupport.plaintext
import dev.octave.session.http.StoreTestSupport.plantRecord
import dev.octave.session.http.StoreTestSupport.recordName
import dev.octave.session.http.StoreTestSupport.recordsDir
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import java.io.File

// T4-05 test plan, StoreFailureTest (docs/specs/T4-05.md, D1, D2; spec check issue 4 and second-round note 2): reading a
// record has three answers. Corrupt deletes it. Unavailable (any other Keystore, provider or file error) keeps it, lists
// nothing for it and opens no session, and a later restore with a working cipher lists it. A save the cipher cannot make
// stores nothing and leaves every record on disk as it was.
//
// The testing contract is in StoreTestSupport.kt.
class StoreFailureTest {
    private val rig = StoreRig("octave-t405-failure")

    @AfterEach
    fun close() = rig.close()

    private val serverId = "0123456789abcdef0123456789abcd0a"

    private fun stored(userId: String, token: String = "t405-fake-token-$userId"): File {
        rig.signedIn(rig.transport(), token, userId, serverId)
        return rig.record(serverId, userId).also { assertTrue(it.isFile, "the sign-in stored the record of $userId") }
    }

    // --- Unavailable keeps the record ---

    @Test
    fun an_unavailable_open_keeps_the_record_lists_nothing_and_a_later_working_restore_lists_it() {
        val record = stored("user-failure-open")
        val bytes = record.readBytes()
        rig.relaunch()
        val held = SessionRegistry.count()

        rig.cipher.openMode = SwitchCipher.Mode.UNAVAILABLE
        assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(), "user-failure-open"), "nothing is listed")
        assertEquals(held, SessionRegistry.count(), "no session is opened")
        assertArrayEquals(bytes, record.readBytes(), "the record is kept as it was")

        rig.cipher.openMode = SwitchCipher.Mode.WORKING
        assertEquals(1, rig.restoredFor(rig.transport(), "user-failure-open").size, "a later restore with a working cipher lists it")
    }

    @Test
    fun a_file_read_that_fails_is_unavailable_and_keeps_the_record() {
        val record = stored("user-failure-read")
        rig.relaunch()
        assertTrue(record.setReadable(false, false), "the record was made unreadable")
        assumeTrue(!record.canRead(), "this user reads an unreadable file (root?), so a read cannot be made to fail")

        try {
            assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(), "user-failure-read"))
            assertTrue(record.exists(), "a record that could not be read is kept")
        } finally {
            record.setReadable(true, true)
        }

        assertEquals(1, rig.restoredFor(rig.transport(), "user-failure-read").size, "once readable it is listed")
    }

    @Test
    fun an_unavailable_seal_stores_nothing_and_the_viewer_is_signed_in_for_this_launch() {
        rig.cipher.sealMode = SwitchCipher.Mode.UNAVAILABLE

        val result = rig.signIn(rig.transport(), "t405-fake-token-seal", "user-failure-seal", serverId)

        assertNotNull(result["session"] as? String, "the sign-in still answers a session: ${result["error"]}")
        assertEquals(setOf("session", "userId", "userName", "serverId"), result.keys, "the result map is unchanged")
        val left = if (recordsDir(rig.root).isDirectory) recordsDir(rig.root).listFiles()!!.map { it.name } else emptyList()
        assertEquals(emptyList<String>(), left, "nothing is stored, and no temporary file is left")
    }

    @Test
    fun a_keystore_unavailable_at_launch_destroys_nothing_and_a_sign_in_in_that_state_leaves_other_records() {
        val same = stored("user-failure-same", "t405-fake-token-same-old")
        val other = stored("user-failure-other")
        val sameBytes = same.readBytes()
        val otherBytes = other.readBytes()
        rig.relaunch()

        rig.cipher.openMode = SwitchCipher.Mode.UNAVAILABLE
        rig.cipher.sealMode = SwitchCipher.Mode.UNAVAILABLE
        val listed = rig.restore(rig.transport()).filter { it["userId"] == "user-failure-same" || it["userId"] == "user-failure-other" }
        assertEquals(emptyList<Map<String, Any?>>(), listed, "nothing can be listed")

        val result = rig.signIn(rig.transport(), "t405-fake-token-same-new", "user-failure-same", serverId)
        assertNotNull(result["session"] as? String, "the viewer signs in for this launch")
        assertArrayEquals(sameBytes, same.readBytes(), "the same account's record is untouched by a save that could not be made")
        assertArrayEquals(otherBytes, other.readBytes(), "every other record stays on disk")

        rig.cipher.sealMode = SwitchCipher.Mode.WORKING
        rig.signIn(rig.transport(), "t405-fake-token-third", "user-failure-third", serverId)
        assertArrayEquals(otherBytes, other.readBytes(), "a working save of another account leaves the record alone")
        assertTrue(same.isFile)
    }

    // --- Corrupt deletes the record ---

    private fun plantedCorrupt(label: String, bytes: (name: String) -> ByteArray): Pair<String, File> {
        val userId = "user-failure-corrupt-$label"
        val name = recordName(serverId, userId)
        val dir = recordsDir(rig.root).also { it.mkdirs() }
        val file = File(dir, name)
        file.writeBytes(bytes(name))
        return userId to file
    }

    private fun sealedBytes(name: String, plain: String, cipher: GcmTestCipher = rig.cipher.inner): ByteArray =
        byteArrayOf(1) + cipher.sealRaw(plain.toByteArray(Charsets.UTF_8), name.toByteArray(Charsets.UTF_8))

    private fun good(userId: String, server: String = rig.server.origin, token: String = "t405-fake-token-good", id: String? = serverId, userName: String? = null) =
        plaintext(server, token, userId, id, userName)

    @Test
    fun each_corrupt_record_is_deleted_and_not_listed() {
        val cases = listOf(
            plantedCorrupt("empty") { ByteArray(0) },
            plantedCorrupt("oversized") { name -> sealedBytes(name, good("user-failure-corrupt-oversized", token = "t".repeat(70_000))) },
            plantedCorrupt("version") { name -> sealedBytes(name, good("user-failure-corrupt-version")).also { it[0] = 2 } },
            plantedCorrupt("tag") { name -> sealedBytes(name, good("user-failure-corrupt-tag")).also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() } },
            plantedCorrupt("other-key") { name -> sealedBytes(name, good("user-failure-corrupt-other-key"), GcmTestCipher()) },
            plantedCorrupt("other-name") { _ -> sealedBytes(recordName(serverId, "someone-else"), good("user-failure-corrupt-other-name")) },
            plantedCorrupt("not-json") { name -> sealedBytes(name, "not a record") },
            plantedCorrupt("json-array") { name -> sealedBytes(name, "[]") },
            plantedCorrupt("empty-token") { name -> sealedBytes(name, good("user-failure-corrupt-empty-token", token = "")) },
            plantedCorrupt("no-server-id") { name -> sealedBytes(name, good("user-failure-corrupt-no-server-id", id = null)) },
            plantedCorrupt("refused-address") { name -> sealedBytes(name, good("user-failure-corrupt-refused-address", server = "not an address")) },
            plantedCorrupt("ftp-address") { name -> sealedBytes(name, good("user-failure-corrupt-ftp-address", server = "ftp://192.168.50.10")) },
            plantedCorrupt("extra-field") { name ->
                val json = good("user-failure-corrupt-extra-field").removeSuffix("}") + ",\"header\":\"MediaBrowser Token=\\\"x\\\"\"}"
                sealedBytes(name, json)
            },
        )

        val listed = rig.restore(rig.transport()).map { it["userId"] }

        for ((userId, file) in cases) {
            assertFalse(userId in listed, "$userId: a corrupt record is not listed")
            assertFalse(file.exists(), "$userId: a corrupt record is deleted")
        }
    }

    @Test
    fun a_key_the_cipher_positively_lacks_reads_as_corrupt_and_the_record_is_deleted() {
        val record = stored("user-failure-no-key")
        rig.relaunch()

        rig.cipher.openMode = SwitchCipher.Mode.CORRUPT
        assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(), "user-failure-no-key"))

        assertFalse(record.exists(), "a record whose key is gone is deleted")
    }

    @Test
    fun a_well_formed_planted_record_is_listed() {
        // The planted layout is the one the store writes, so the corrupt cases above differ from a good record in one way each.
        val userId = "user-failure-planted-good"
        plantRecord(rig.root, rig.cipher.inner, recordName(serverId, userId), good(userId, userName = "Fixture Viewer"))

        val entry = rig.restoredFor(rig.transport(), userId).single()

        assertEquals(serverId, entry["serverId"])
        assertEquals("Fixture Viewer", entry["userName"])
    }
}
