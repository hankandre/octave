package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.json
import mockwebserver3.MockResponse
import mockwebserver3.SocketEffect
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.util.concurrent.atomic.AtomicReference

// T4-05 item 4 (docs/specs/T4-05.md, D3, D5): sign-out deletes the stored record and removes the registry entry, then
// sends POST /Sessions/Logout with the token, whatever the logout answers. A transport built with no store still deletes
// the record, because the entry names its file. A delete that fails leaves an empty file, which holds no token and which
// the next restore removes. Ending an older session of an account whose record a newer sign-in replaced never deletes the
// newer record.
//
// The testing contract is in StoreTestSupport.kt.
class SignOutStoreTest {
    private val rig = StoreRig("octave-t405-signout")

    @AfterEach
    fun close() = rig.close()

    private val token = "t405-fake-token-signout-9c0d"
    private val serverId = "0123456789abcdef0123456789abcd04"

    private fun end(transport: SessionTransport, session: String): Map<String, Any?> =
        transport.endSession(mapOf("session" to session, "timeoutMs" to 5_000.0))

    private class AtLogout(val recordExisted: Boolean, val sessionHeld: Boolean, val authorization: String?)

    @Test
    fun sign_out_clears_memory_and_store_even_when_logout_fails() {
        val answers = listOf(
            "a 200" to { MockResponse(200) },
            "a 500" to { json(500, """{"Message":"fixture failure"}""") },
            "a dropped connection" to { MockResponse.Builder().onResponseStart(SocketEffect.CloseSocket()).build() },
        )
        for ((index, pair) in answers.withIndex()) {
            val (label, answer) = pair
            val userId = "user-signout-$index"
            val session = rig.signedIn(rig.transport(), token, userId, serverId)
            val record = rig.record(serverId, userId)
            assertTrue(record.isFile, "$label: the sign-in stored the record")
            val seen = AtomicReference<AtLogout>()
            rig.server.answer("/Sessions/Logout") { request ->
                seen.compareAndSet(null, AtLogout(record.exists(), SessionRegistry.holds(SessionId.parse(session)!!), request.headers["Authorization"]))
                answer()
            }

            end(rig.transport(), session)

            val atLogout = checkNotNull(seen.get()) { "$label: the logout was sent" }
            assertFalse(atLogout.recordExisted, "$label: the record was deleted before the logout was sent")
            assertFalse(atLogout.sessionHeld, "$label: the entry was removed before the logout was sent")
            assertTrue(atLogout.authorization?.contains("Token=\"$token\"") == true, "$label: the logout carried the token")
            assertFalse(record.exists(), "$label: the record is gone")
            assertFalse(SessionRegistry.holds(SessionId.parse(session)!!), "$label: the registry does not hold the session")
            rig.relaunch()
            assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(), userId), "$label: a new store lists nothing for the account")
        }
    }

    @Test
    fun a_transport_built_with_no_store_deletes_the_record() {
        val session = rig.signedIn(rig.transport(), token, "user-signout-nostore", serverId)
        val record = rig.record(serverId, "user-signout-nostore")
        assertTrue(record.isFile)
        rig.server.answer("/Sessions/Logout") { MockResponse(204) }

        val bare = SessionTransport(StoreTestSupport.identity, StoreTestSupport.release)
        assertEquals(emptyMap<String, Any?>(), end(bare, session))

        assertFalse(record.exists(), "the record is gone though the transport had no store")
        rig.relaunch()
        assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(), "user-signout-nostore"))
    }

    @Test
    fun a_delete_that_fails_leaves_an_empty_file_that_the_next_restore_removes() {
        val session = rig.signedIn(rig.transport(), token, "user-signout-locked", serverId)
        val record = rig.record(serverId, "user-signout-locked")
        val dir = record.parentFile
        assertTrue(dir.setWritable(false), "the records directory was made read-only")
        val probe = File(dir, "probe")
        assumeTrue(!runCatching { probe.createNewFile() }.getOrDefault(false), "this user can write a read-only directory (root?), so a delete cannot be made to fail")
        rig.server.answer("/Sessions/Logout") { MockResponse(204) }

        try {
            end(rig.transport(), session)
            assertFalse(SessionRegistry.holds(SessionId.parse(session)!!), "the session is ended")
            assertTrue(!record.exists() || record.length() == 0L, "a record left behind holds no bytes")
        } finally {
            dir.setWritable(true)
        }

        rig.relaunch()
        assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(), "user-signout-locked"))
        assertFalse(record.exists(), "the next restore removed the empty file")
    }

    @Test
    fun ending_an_older_session_never_deletes_the_newer_record() {
        val older = rig.signedIn(rig.transport(), token, "user-signout-replaced", serverId)
        val newerToken = "t405-fake-token-newer-signout-e1f2"
        val newer = rig.signedIn(rig.transport(), newerToken, "user-signout-replaced", serverId)
        val record = rig.record(serverId, "user-signout-replaced")
        rig.server.answer("/Sessions/Logout") { MockResponse(204) }

        end(rig.transport(), older)

        assertTrue(record.isFile, "the newer sign-in's record is kept")
        assertTrue(SessionRegistry.holds(SessionId.parse(newer)!!), "the newer session is untouched")
        rig.relaunch()
        val restored = rig.restoredFor(rig.transport(), "user-signout-replaced").single()
        rig.server.answer("/Users/Me") { json(200, "{}") }
        rig.transport().request(mapOf("session" to restored["session"], "method" to "GET", "path" to "/Users/Me", "timeoutMs" to 5_000.0))
        assertTrue(rig.server.requests.last().headers["Authorization"]?.contains("Token=\"$newerToken\"") == true, "the record holds the newer token")
    }
}
