package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// T3-05 (spec check note 1): SessionTransport holds no lock across a call, so a second request completes while a
// first is stalled at the server. OctaveSessionModule runs each call on its IO scope, off Expo's one modules queue;
// the wire test transport-errors shows the same on the device.
class ConcurrencyTest {
    private val server = PathServer()
    private val release = CountDownLatch(1)

    @AfterEach
    fun close() {
        release.countDown()
        server.close()
    }

    @Test
    fun a_second_request_completes_while_a_first_is_stalled() {
        val session = signIn(server)
        val stalled = CountDownLatch(1)
        server.answer("/Items/stall") {
            stalled.countDown()
            release.await(10, TimeUnit.SECONDS)
            json(200, """{"slow":true}""")
        }
        server.answer("/Items/fast") { json(200, """{"fast":true}""") }
        val pool = Executors.newFixedThreadPool(2)
        try {
            val slow = pool.submit<Map<String, Any?>> { sessionRequest(session, "GET", "/Items/stall") }
            assertTrue(stalled.await(5, TimeUnit.SECONDS), "the first request reached the server")
            val fast = pool.submit<Map<String, Any?>> { sessionRequest(session, "GET", "/Items/fast") }
            assertEquals(mapOf("status" to 200, "body" to """{"fast":true}"""), fast.get(5, TimeUnit.SECONDS))
            assertTrue(!slow.isDone, "the first request is still stalled")
            release.countDown()
            assertEquals(mapOf("status" to 200, "body" to """{"slow":true}"""), slow.get(5, TimeUnit.SECONDS))
        } finally {
            pool.shutdownNow()
            SessionRegistry.close(SessionId.parse(session)!!)
        }
    }
}
