package dev.octave.session.http

import dev.octave.session.http.StoreTestSupport.DEVICE_ID
import dev.octave.session.http.TransportTestSupport.json
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T4-05 item 2 (docs/specs/T4-05.md, D4): after a relaunch, restoreSessions lists the stored account under a new
// session id, and a request with that id carries the stored token in the header Kotlin builds again. restore sends
// nothing itself (validation is the core's, D6), answers the same ids to a second call in the same process, and lists the
// newest record first.
//
// The testing contract is in StoreTestSupport.kt.
class RestoreSessionsTest {
    private val rig = StoreRig("octave-t405-restore")

    @AfterEach
    fun close() = rig.close()

    private val token = "t405-fake-token-restore-7a8b"
    private val serverId = "0123456789abcdef0123456789abcd02"

    private fun me(transport: SessionTransport, session: String): String {
        rig.server.answer("/Users/Me") { json(200, "{}") }
        val result = transport.request(mapOf("session" to session, "method" to "GET", "path" to "/Users/Me", "timeoutMs" to 5_000.0))
        assertEquals(200, result["status"], "GET /Users/Me with the session: ${result["error"]}")
        return checkNotNull(rig.server.requests.last().headers["Authorization"]) { "the request carried no Authorization header" }
    }

    @Test
    fun a_new_store_over_the_same_directory_lists_the_account_under_a_new_id_and_its_requests_carry_the_stored_token() {
        val first = rig.transport()
        val signedIn = rig.signedIn(first, token, "user-restore-1", serverId, name = "Fixture Viewer")
        val before = me(first, signedIn)
        assertTrue(before.contains("Token=\"$token\""), "the signed-in header carries the token")
        rig.relaunch()

        val restored = rig.restoredFor(rig.transport(), "user-restore-1")

        assertEquals(1, restored.size, "the stored account is listed once")
        val entry = restored.single()
        assertEquals(setOf("session", "server", "deviceId", "userId", "serverId", "userName"), entry.keys, "the result's fields")
        val session = entry["session"] as String
        assertNotNull(SessionId.parse(session), "the id is 32 lower-case hex digits")
        assertNotEquals(signedIn, session, "a restored session gets a new id")
        assertEquals(rig.server.origin, entry["server"])
        assertEquals(DEVICE_ID, entry["deviceId"])
        assertEquals(serverId, entry["serverId"])
        assertEquals("Fixture Viewer", entry["userName"])

        assertEquals(before, me(rig.transport(), session), "the restored session's header is the one the sign-in built")
    }

    @Test
    fun a_restore_sends_no_request() {
        rig.signedIn(rig.transport(), token, "user-restore-2", serverId)
        rig.relaunch()
        val sent = rig.server.requests.size

        assertEquals(1, rig.restoredFor(rig.transport(), "user-restore-2").size)

        assertEquals(sent, rig.server.requests.size, "requests sent by the restore")
    }

    @Test
    fun a_second_restore_in_the_same_process_answers_the_same_ids_and_opens_no_second_session() {
        rig.signedIn(rig.transport(), token, "user-restore-3", serverId)
        rig.relaunch()
        val held = SessionRegistry.count()

        val once = rig.restoredFor(rig.transport(), "user-restore-3").map { it["session"] }
        val twice = rig.restoredFor(rig.transport(), "user-restore-3").map { it["session"] }

        assertEquals(1, once.size)
        assertEquals(once, twice, "the same id back while the process lives")
        assertEquals(held + 1, SessionRegistry.count(), "one session is opened for one record")
    }

    @Test
    fun a_record_with_no_user_name_lists_none() {
        rig.signedIn(rig.transport(), token, "user-restore-4", serverId, name = null)
        rig.relaunch()

        val entry = rig.restoredFor(rig.transport(), "user-restore-4").single()

        assertFalse(entry.containsKey("userName"), "no userName when the sign-in named none")
    }

    @Test
    fun the_newest_record_is_listed_first() {
        rig.signedIn(rig.transport(), "t405-fake-token-older-1111", "user-restore-older", serverId)
        rig.signedIn(rig.transport(), "t405-fake-token-newer-2222", "user-restore-newer", serverId)
        rig.relaunch()
        val now = System.currentTimeMillis()
        // The older account's record is the newer file, so the order follows the files, not the sign-ins.
        assertTrue(rig.record(serverId, "user-restore-newer").setLastModified(now - 120_000))
        assertTrue(rig.record(serverId, "user-restore-older").setLastModified(now - 60_000))

        val order = rig.restore(rig.transport())
            .map { it["userId"] }
            .filter { it == "user-restore-older" || it == "user-restore-newer" }

        assertEquals(listOf("user-restore-older", "user-restore-newer"), order, "newest record first")
    }
}
