package dev.octave.session.http

import dev.octave.session.http.StoreTestSupport.recordName
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// T4-05 test plan, StoreLockTest (docs/specs/T4-05.md, D3; spec check issue 5): one process-wide lock guards save,
// forget and restore. A restore that races an endSession never opens a session for the ended account; two concurrent
// restores open one session for one record and answer the same id; a restore running beside a save never costs the
// save its record. Each race runs many rounds on two threads released together; the cipher double widens the window
// in which a restore that is not locked would read a record that is being removed.
//
// The testing contract is in StoreTestSupport.kt.
class StoreLockTest {
    private val rig = StoreRig("octave-t405-lock")
    private val pool = Executors.newFixedThreadPool(2)

    @AfterEach
    fun close() {
        pool.shutdownNow()
        rig.close()
    }

    private val serverId = "0123456789abcdef0123456789abcd0c"

    private fun <A, B> together(first: () -> A, second: () -> B): Pair<A, B> {
        val barrier = CyclicBarrier(2)
        val a = pool.submit<A> {
            barrier.await(5, TimeUnit.SECONDS)
            first()
        }
        val b = pool.submit<B> {
            barrier.await(5, TimeUnit.SECONDS)
            second()
        }
        return a.get(30, TimeUnit.SECONDS) to b.get(30, TimeUnit.SECONDS)
    }

    @Test
    fun a_restore_that_races_an_end_session_never_opens_a_session_for_the_ended_account() {
        rig.server.answer("/Sessions/Logout") { MockResponse(204) }
        repeat(40) { round ->
            val userId = "user-lock-ended-$round"
            val session = rig.signedIn(rig.transport(), "t405-fake-token-ended-$round", userId, serverId)
            val name = recordName(serverId, userId).toByteArray(Charsets.UTF_8)
            val ended = CountDownLatch(1)
            // A restore that reads this record while the session is ending waits here for the end to finish.
            rig.cipher.beforeOpen = { associated -> if (associated.contentEquals(name)) ended.await(300, TimeUnit.MILLISECONDS) }

            val (restored, _) = together(
                { rig.restore(rig.transport()) },
                { rig.transport().endSession(mapOf("session" to session, "timeoutMs" to 5_000.0)).also { ended.countDown() } },
            )
            rig.cipher.beforeOpen = {}

            val reopened = restored.filter { it["userId"] == userId && it["session"] != session }
            assertEquals(emptyList<Map<String, Any?>>(), reopened, "round $round: no session was opened for the ended account")
            assertFalse(rig.record(serverId, userId).exists(), "round $round: the record is gone")
            assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(), userId), "round $round: nothing is restored afterwards")
        }
    }

    @Test
    fun two_concurrent_restores_open_one_session_for_one_record_and_answer_the_same_id() {
        repeat(20) { round ->
            val userId = "user-lock-twice-$round"
            rig.signedIn(rig.transport(), "t405-fake-token-twice-$round", userId, serverId)
            rig.relaunch()
            val held = SessionRegistry.count()
            rig.cipher.beforeOpen = { Thread.sleep(20) }

            val (first, second) = together({ rig.restoredFor(rig.transport(), userId) }, { rig.restoredFor(rig.transport(), userId) })
            rig.cipher.beforeOpen = {}

            assertEquals(1, first.size, "round $round: the first restore lists the account once")
            assertEquals(first.map { it["session"] }, second.map { it["session"] }, "round $round: both answer the same id")
            // relaunch() closed every session this rig saw, the earlier rounds' restored ones included, so the records of
            // rounds 0 to `round` all have no live entry and each is opened once (D4), by the two restores together.
            assertEquals(held + round + 1, SessionRegistry.count(), "round $round: one session is opened for each record")
        }
    }

    @Test
    fun a_restore_beside_a_save_never_costs_the_save_its_record() {
        repeat(30) { round ->
            val userId = "user-lock-save-$round"
            val token = "t405-fake-token-save-$round"
            rig.server.answer("/Users/AuthenticateByName") { StoreTestSupport.signInAnswer(token, userId, serverId) }
            rig.cipher.beforeSeal = { Thread.sleep(5) }

            val (signedIn, _) = together(
                { rig.transport().signIn(StoreTestSupport.passwordArgs(rig.server.origin)) },
                { rig.restore(rig.transport()) },
            )
            rig.cipher.beforeSeal = {}

            assertTrue(signedIn["session"] is String, "round $round: the sign-in answered a session")
            val record = rig.record(serverId, userId)
            assertTrue(record.isFile, "round $round: the record was saved")
            val bytes = record.readBytes()
            val plain = rig.cipher.inner.openRaw(bytes.copyOfRange(1, bytes.size), record.name.toByteArray(Charsets.UTF_8))
            assertEquals(token, Json.parseToJsonElement(String(checkNotNull(plain), Charsets.UTF_8)).jsonObject.getValue("token").jsonPrimitive.content)
            val leftovers = record.parentFile.listFiles()!!.map { it.name }.filterNot { it.length == 64 && it.all { char -> char in "0123456789abcdef" } }
            assertEquals(emptyList<String>(), leftovers, "round $round: no temporary file is left")
            SessionId.parse(signedIn["session"] as String)?.let { SessionRegistry.close(it) }
        }
    }
}
