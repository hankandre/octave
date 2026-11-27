package dev.octave.session.http

import dev.octave.session.http.StoreTestSupport.recordName
import mockwebserver3.MockResponse
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import java.io.File

// T4-05, guardian G-M1 and G-L5 (docs/specs/T4-05.md, Q5; PRODUCT.md, "one person must not open another's"): only the
// newest record may be restored. When the newest record is kept but cannot be opened (the Keystore was unavailable, the
// file could not be read, or a development build refused its address), restore opens and lists no older account; a
// record whose age cannot be read counts as the newest. A session that is live and newer than such a record is still
// listed (a restarted JavaScript runtime). A file whose read fails is never taken for an empty, corrupt one.
class NewestRecordTest {
    private val rig = StoreRig("octave-t405-newest")

    @AfterEach
    fun close() = rig.close()

    private val serverId = "0123456789abcdef0123456789abcd1a"

    private fun storedPair(): Pair<File, File> {
        rig.signedIn(rig.transport(), "t405-fake-token-older", "user-older", serverId)
        rig.signedIn(rig.transport(), "t405-fake-token-newer", "user-newer", serverId)
        val older = rig.record(serverId, "user-older")
        val newer = rig.record(serverId, "user-newer")
        val now = System.currentTimeMillis()
        assertTrue(older.setLastModified(now - 120_000))
        assertTrue(newer.setLastModified(now - 60_000))
        rig.relaunch()
        return older to newer
    }

    private fun failOpenOf(userId: String) {
        val name = recordName(serverId, userId).toByteArray(Charsets.UTF_8)
        rig.cipher.beforeOpen = { associated -> if (associated.contentEquals(name)) throw IllegalStateException("fixture: keystore busy") }
    }

    private fun ours(listed: List<Map<String, Any?>>) = listed.map { it["userId"] }.filter { it == "user-older" || it == "user-newer" }

    @Test
    fun an_unavailable_newest_record_opens_and_lists_no_older_account() {
        val (older, newer) = storedPair()
        failOpenOf("user-newer")
        val held = SessionRegistry.count()

        val listed = rig.restore(rig.transport())

        assertEquals(emptyList<Any?>(), ours(listed), "no account is listed")
        assertEquals(held, SessionRegistry.count(), "no session is opened")
        assertTrue(older.isFile && newer.isFile, "both records are kept")

        rig.cipher.beforeOpen = {}
        assertEquals(listOf("user-newer", "user-older"), ours(rig.restore(rig.transport())), "a working restore lists both, newest first")
    }

    @Test
    fun a_newest_record_the_development_rule_refuses_opens_and_lists_no_older_account() {
        val older = StoreTestSupport.plantRecord(rig.root, rig.cipher.inner, recordName(serverId, "user-older"), StoreTestSupport.plaintext(rig.server.origin, "t405-fake-token-o", "user-older", serverId))
        val newer = StoreTestSupport.plantRecord(rig.root, rig.cipher.inner, recordName(serverId, "user-newer"), StoreTestSupport.plaintext("http://192.168.50.10:8096", "t405-fake-token-n", "user-newer", serverId))
        val now = System.currentTimeMillis()
        assertTrue(older.setLastModified(now - 120_000))
        assertTrue(newer.setLastModified(now - 60_000))
        val held = SessionRegistry.count()

        val listed = rig.restore(rig.transport(DevelopmentServers.forBuild(true, "")))

        assertEquals(emptyList<Any?>(), ours(listed))
        assertEquals(held, SessionRegistry.count(), "no session is opened")
        assertTrue(older.isFile && newer.isFile)
    }

    @Test
    fun a_corrupt_newest_record_is_deleted_and_the_next_one_is_the_newest() {
        val (older, newer) = storedPair()
        rig.cipher.beforeOpen = {}
        val bytes = newer.readBytes()
        bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 1).toByte()
        newer.writeBytes(bytes)
        assertTrue(newer.setLastModified(System.currentTimeMillis() - 60_000))

        assertEquals(listOf("user-older"), ours(rig.restore(rig.transport())))
        assertFalse(newer.exists(), "the corrupt record is deleted")
        assertTrue(older.isFile)
    }

    @Test
    fun a_live_session_newer_than_an_unavailable_record_is_still_listed() {
        val (_, _) = storedPair()
        failOpenOf("user-older")
        rig.cipher.sealMode = SwitchCipher.Mode.WORKING
        val later = rig.signedIn(rig.transport(), "t405-fake-token-later", "user-later", serverId)

        val listed = rig.restore(rig.transport()).map { it["session"] }

        assertTrue(later in listed, "the live, newest session is listed for a restarted runtime")
    }

    @Test
    fun a_record_whose_file_cannot_be_read_is_unavailable_not_corrupt_and_blocks_older_ones() {
        val (older, newer) = storedPair()
        val dir = newer.parentFile
        // Without the execute bit, a file's length reads 0 and opening it fails, while its name is still listed.
        assertTrue(dir.setExecutable(false, false))
        assumeTrue(!newer.canRead() && newer.length() == 0L, "this user can still stat the file (root?)")
        try {
            assertEquals(SessionStore.Read.Unavailable, rig.store().read(newer), "a failed read is unavailable")
            assertEquals(emptyList<Any?>(), ours(rig.restore(rig.transport())), "a record of unknown age blocks the older ones")
        } finally {
            dir.setExecutable(true, false)
        }
        assertTrue(older.isFile && newer.isFile, "nothing was deleted")
        assertEquals(listOf("user-newer", "user-older"), ours(rig.restore(rig.transport())))
    }

    @Test
    fun an_empty_file_that_reads_as_empty_is_corrupt() {
        val record = File(StoreTestSupport.recordsDir(rig.root).also { it.mkdirs() }, recordName(serverId, "user-empty"))
        record.writeBytes(ByteArray(0))
        assertEquals(SessionStore.Read.Corrupt, rig.store().read(record))
    }

    // --- G-M2: a refused save, then sign-out ---

    @Test
    fun signing_out_after_a_refused_save_leaves_no_record_for_the_account() {
        rig.signedIn(rig.transport(), "t405-fake-token-first", "user-refused", serverId)
        val record = rig.record(serverId, "user-refused")
        assertTrue(record.isFile)
        rig.relaunch()
        rig.cipher.sealMode = SwitchCipher.Mode.UNAVAILABLE
        val second = rig.signedIn(rig.transport(), "t405-fake-token-second", "user-refused", serverId)
        assertTrue(record.isFile, "the refused save left the earlier record untouched")
        assertEquals(listOf(second), rig.restoredFor(rig.transport(), "user-refused").map { it["session"] }, "the current session names the account's record")

        rig.server.answer("/Sessions/Logout") { MockResponse(204) }
        rig.transport().endSession(mapOf("session" to second, "timeoutMs" to 5_000.0))

        assertFalse(record.exists(), "sign-out leaves no record for the account")
        rig.relaunch()
        rig.cipher.sealMode = SwitchCipher.Mode.WORKING
        assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(), "user-refused"))
    }

    // --- S-L2: an abandoned re-sign-in is ended by the app's adapter ---

    @Test
    fun ending_an_abandoned_re_sign_in_deletes_the_record_that_holds_its_ended_token_and_no_other() {
        rig.signedIn(rig.transport(), "t405-fake-token-kept", "user-other", serverId)
        rig.signedIn(rig.transport(), "t405-fake-token-before", "user-again", serverId)
        rig.relaunch()
        val earlier = rig.restoredFor(rig.transport(), "user-again").single()["session"] as String
        val abandoned = rig.signedIn(rig.transport(), "t405-fake-token-abandoned", "user-again", serverId)
        var logoutAuthorization: String? = null
        rig.server.answer("/Sessions/Logout") { request ->
            logoutAuthorization = request.headers["Authorization"]
            MockResponse(204)
        }

        rig.transport().endSession(mapOf("session" to abandoned, "timeoutMs" to 5_000.0))

        assertTrue(logoutAuthorization?.contains("Token=\"t405-fake-token-abandoned\"") == true, "the abandoned session is logged out")
        assertFalse(rig.record(serverId, "user-again").exists(), "the record held the ended token and is deleted")
        assertTrue(rig.record(serverId, "user-other").isFile, "another account's record is untouched")
        assertTrue(SessionRegistry.holds(checkNotNull(SessionId.parse(earlier))), "the earlier session stays open in memory, named by no record")
    }
}
