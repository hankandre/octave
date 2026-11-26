package dev.octave.session.http

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// T4-05 (docs/specs/T4-05.md, D4; second spec check, note 4): restoreSessions lists only sessions that have a stored
// record. A sign-in that stored nothing (no server id, or a save the cipher could not make) is not listed, so a reloaded
// JavaScript runtime gets back exactly what a relaunch would; the session itself still works for the code that holds
// its id. Also: two concurrent restores over a fresh store open one session for its one record.
class StoreListingTest {
    private val serverId = "0123456789abcdef0123456789abcd0e"

    private fun request(transport: SessionTransport, session: String): Any? =
        transport.request(mapOf("session" to session, "method" to "GET", "path" to "/Users/Me", "timeoutMs" to 5_000.0))["status"]

    @Test
    fun a_session_with_no_record_is_not_listed_and_still_works() {
        StoreRig("octave-t405-listing").use { rig ->
            rig.server.answer("/Users/Me") { TransportTestSupport.json(200, "{}") }
            val unnamed = rig.signedIn(rig.transport(), "t405-fake-token-noid", "user-listing-noid", serverId = null)
            rig.cipher.sealMode = SwitchCipher.Mode.UNAVAILABLE
            val unsaved = rig.signedIn(rig.transport(), "t405-fake-token-unsaved", "user-listing-unsaved", serverId)
            rig.cipher.sealMode = SwitchCipher.Mode.WORKING

            val listed = rig.restore(rig.transport()).map { it["session"] }

            assertTrue(unnamed !in listed && unsaved !in listed, "neither session without a record is listed")
            assertEquals(200, request(rig.transport(), unnamed))
            assertEquals(200, request(rig.transport(), unsaved))
        }
    }

    @Test
    fun a_listed_session_s_record_lives_in_the_store_that_lists_it() {
        StoreRig("octave-t405-listing-a").use { first ->
            StoreRig("octave-t405-listing-b").use { second ->
                val session = first.signedIn(first.transport(), "t405-fake-token-a", "user-listing-a", serverId)

                assertEquals(emptyList<Any?>(), second.restore(second.transport()).map { it["session"] }.filter { it == session })
                assertEquals(listOf(session), first.restore(first.transport()).map { it["session"] }.filter { it == session })
            }
        }
    }

    @Test
    fun two_concurrent_restores_over_a_fresh_store_open_one_session_and_answer_the_same_id() {
        val pool = Executors.newFixedThreadPool(2)
        try {
            repeat(20) { round ->
                StoreRig("octave-t405-listing-race").use { rig ->
                    rig.signedIn(rig.transport(), "t405-fake-token-race-$round", "user-listing-race", serverId)
                    rig.relaunch()
                    val held = SessionRegistry.count()
                    rig.cipher.beforeOpen = { Thread.sleep(20) }
                    val barrier = CyclicBarrier(2)
                    val runs = List(2) {
                        pool.submit<List<Any?>> {
                            barrier.await(5, TimeUnit.SECONDS)
                            rig.restoredFor(rig.transport(), "user-listing-race").map { it["session"] }
                        }
                    }
                    val (first, second) = runs.map { it.get(30, TimeUnit.SECONDS) }

                    assertEquals(1, first.size, "round $round: listed once")
                    assertEquals(first, second, "round $round: the same id")
                    assertEquals(held + 1, SessionRegistry.count(), "round $round: one session opened")
                }
            }
        } finally {
            pool.shutdownNow()
        }
    }
}
