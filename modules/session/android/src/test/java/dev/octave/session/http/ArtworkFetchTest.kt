package dev.octave.session.http

import dev.octave.session.http.TestSupport.CANARY
import dev.octave.session.http.TestSupport.header
import mockwebserver3.MockResponse
import okhttp3.Headers.Companion.headersOf
import okio.Buffer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.lang.reflect.Modifier
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

// T3-11 acceptance item 2 (docs/specs/T3-11.md, "The fetch"; spec check issue 1): every image request goes through the
// one OkHttp client with the session's header, and nothing but bytes or Failed leaves ArtworkFetch.
//
// The contract frozen here (the session module's HTTP package, public, Kotlin only):
// - ArtworkFetch.prepare(session: SessionId, request: ArtworkRequest): PreparedArtwork?, null with nothing sent for a
//   session the registry does not hold.
// - PreparedArtwork is a public interface: execute(timeoutMs: Long): ArtworkAnswer and cancel(). Its implementation is
//   internal; another module's tests implement the interface with a fake.
// - ArtworkAnswer is sealed: Bytes(bytes: ByteArray), whose constructor is public, and Failed.
// - execute sends one GET through the one client with Accept: image/* and the session's MediaBrowser header, and the
//   URL holds no token. A 2xx body within 8 MiB (ResponseCaps.SESSION_READ) is Bytes. A status other than 2xx, a 3xx,
//   a session ended before the send, a timeout, a cancel, a connection failure and a body over 8 MiB, declared or
//   streamed, are each Failed; no exception leaves. A 401 does not end the session (T4-05's rule).
// - toString() of ArtworkRequest, PreparedArtwork and ArtworkAnswer.Bytes holds no token, session id, item id, tag or
//   address.
class ArtworkFetchTest {
    private val itemId = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
    private val tag = "5f3e2d1c0b9a87654321fedcba987654"
    private val request = ArtworkRequest(itemId, "Primary", tag, 248)
    private val image = byteArrayOf(0x52, 0x49, 0x46, 0x46, 0x0a, 0x0b, 0x0c, 0x0d)
    private val cap = 8 * 1024 * 1024

    private fun ok(bytes: ByteArray = image): MockResponse =
        MockResponse.Builder().code(200).addHeader("Content-Type", "image/webp").body(Buffer().write(bytes)).build()

    private fun withServer(fallback: MockResponse = ok(), block: (TestServer) -> Unit) {
        val server = TestServer(fallback)
        server.start()
        try {
            block(server)
        } finally {
            server.close()
        }
    }

    private fun assertFailed(answer: ArtworkAnswer, what: String) {
        assertTrue(answer is ArtworkAnswer.Failed, "$what is Failed")
    }

    @Test
    fun the_image_request_carries_the_sessions_header_and_no_token_in_its_url() {
        withServer { server ->
            TestSupport.withSession(server.origin, header(CANARY)) { session, _ ->
                val prepared = ArtworkFetch.prepare(session, request)
                assertNotNull(prepared, "a held session and a valid request are prepared")
                val answer = prepared!!.execute(5_000)
                assertTrue(answer is ArtworkAnswer.Bytes, "a 200 answer is Bytes")
                assertTrue(image.contentEquals((answer as ArtworkAnswer.Bytes).bytes), "the bytes are the body")
                val recorded = server.requests.single()
                assertEquals("GET", recorded.method)
                assertEquals(header(CANARY), recorded.headers["Authorization"], "the session's MediaBrowser header")
                assertEquals("image/*", recorded.headers["Accept"])
                for (form in TokenStrip.forms(CANARY)) assertFalse(recorded.target.contains(form), "the URL holds no form of the token")
                assertEquals("/Items/$itemId/Images/Primary?tag=$tag&maxWidth=248&quality=90&format=Webp", recorded.target)
            }
        }
    }

    @Test
    fun a_session_the_registry_does_not_hold_sends_nothing() {
        withServer { server ->
            val unknown = SessionId.parse("0123456789abcdef0123456789abcdef")!!
            assertNull(ArtworkFetch.prepare(unknown, request), "an id no sign-in opened")
            val ended = SessionRegistry.open(server.origin, TestSupport.authorization())
            SessionRegistry.close(ended)
            assertNull(ArtworkFetch.prepare(ended, request), "an ended session")
            assertEquals(0, server.requestCount, "server request count")
            assertEquals(0, server.connections, "connections accepted")
        }
    }

    @Test
    fun a_session_ended_between_prepare_and_execute_is_failed_and_sends_nothing() {
        withServer { server ->
            val session = SessionRegistry.open(server.origin, TestSupport.authorization())
            val prepared = ArtworkFetch.prepare(session, request)
            assertNotNull(prepared)
            SessionRegistry.close(session)
            assertFailed(prepared!!.execute(5_000), "a call after the session ended")
            assertEquals(0, server.requestCount, "server request count")
        }
    }

    @Test
    fun a_redirect_is_failed_and_the_other_origin_receives_nothing() {
        TwoServers().use { servers ->
            for (code in listOf(301, 302, 307, 308)) {
                servers.a.enqueue(MockResponse(code, headersOf("Location", servers.b.url("/Items/$itemId/Images/Primary"))))
                TestSupport.withSession(servers.a.origin) { session, _ ->
                    assertFailed(ArtworkFetch.prepare(session, request)!!.execute(5_000), "a $code answer")
                }
            }
            servers.assertBReceivedNothing()
        }
    }

    @Test
    fun a_base_path_is_kept() {
        withServer { server ->
            TestSupport.withSession(server.origin + "/jf") { session, _ ->
                assertTrue(ArtworkFetch.prepare(session, request)!!.execute(5_000) is ArtworkAnswer.Bytes)
                assertEquals("/jf/Items/$itemId/Images/Primary?tag=$tag&maxWidth=248&quality=90&format=Webp", server.requests.single().target)
            }
        }
    }

    @Test
    fun a_status_other_than_2xx_is_failed_and_a_401_does_not_end_the_session() {
        for (code in listOf(401, 403, 404, 500, 503)) {
            withServer(MockResponse(code, body = "no image")) { server ->
                TestSupport.withSession(server.origin) { session, _ ->
                    assertFailed(ArtworkFetch.prepare(session, request)!!.execute(5_000), "a $code answer")
                    assertTrue(SessionRegistry.holds(session), "the session is still held after $code")
                    assertEquals(1, server.requestCount, "one request for $code, no resend")
                }
            }
        }
    }

    @Test
    fun a_body_over_8_mib_is_failed_declared_or_streamed_and_exactly_8_mib_crosses() {
        val over = ByteArray(cap + 1) { 7 }
        val declared = MockResponse.Builder().code(200).addHeader("Content-Type", "image/webp").body(Buffer().write(over)).build()
        val streamed = MockResponse.Builder().code(200).addHeader("Content-Type", "image/webp").chunkedBody(Buffer().write(over), 64 * 1024).build()
        for ((form, response) in listOf("declared" to declared, "streamed" to streamed)) {
            withServer(response) { server ->
                TestSupport.withSession(server.origin) { session, _ ->
                    assertFailed(ArtworkFetch.prepare(session, request)!!.execute(10_000), "a $form body of 8 MiB + 1")
                }
            }
        }
        val exact = ByteArray(cap) { 7 }
        withServer(MockResponse.Builder().code(200).body(Buffer().write(exact)).build()) { server ->
            TestSupport.withSession(server.origin) { session, _ ->
                val answer = ArtworkFetch.prepare(session, request)!!.execute(10_000)
                assertTrue(answer is ArtworkAnswer.Bytes, "a body of exactly 8 MiB crosses")
                assertEquals(cap, (answer as ArtworkAnswer.Bytes).bytes.size)
            }
        }
    }

    @Test
    fun a_cancel_during_the_body_is_failed() {
        val slow = MockResponse.Builder().code(200).body(Buffer().write(ByteArray(512 * 1024) { 1 })).throttleBody(1024, 100, TimeUnit.MILLISECONDS).build()
        withServer(slow) { server ->
            TestSupport.withSession(server.origin) { session, _ ->
                val prepared = ArtworkFetch.prepare(session, request)!!
                val result = AtomicReference<Any?>(null)
                val worker = thread {
                    result.set(
                        try {
                            prepared.execute(30_000)
                        } catch (error: Throwable) {
                            error
                        },
                    )
                }
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                while (server.requestCount == 0 && System.nanoTime() < deadline) Thread.sleep(20)
                Thread.sleep(300)
                prepared.cancel()
                worker.join(10_000)
                assertFalse(worker.isAlive, "execute returned after the cancel")
                val answer = result.get()
                assertTrue(answer is ArtworkAnswer.Failed, "a cancelled call is Failed, not ${answer?.javaClass?.simpleName}")
            }
        }
    }

    @Test
    fun a_timeout_and_a_connection_failure_are_failed() {
        val late = MockResponse.Builder().headersDelay(5, TimeUnit.SECONDS).code(200).body(Buffer().write(image)).build()
        withServer(late) { server ->
            TestSupport.withSession(server.origin) { session, _ ->
                val started = System.nanoTime()
                assertFailed(ArtworkFetch.prepare(session, request)!!.execute(300), "a call past its timeout")
                assertTrue(System.nanoTime() - started < TimeUnit.SECONDS.toNanos(4), "the timeout ended the call")
            }
        }
        val closed = TestServer(ok())
        closed.start()
        val origin = closed.origin
        closed.close()
        TestSupport.withSession(origin) { session, _ ->
            assertFailed(ArtworkFetch.prepare(session, request)!!.execute(2_000), "a refused connection")
        }
    }

    @Test
    fun the_public_types_are_the_ones_another_module_can_build_and_fake() {
        assertTrue(PreparedArtwork::class.java.isInterface, "PreparedArtwork is an interface")
        assertTrue(Modifier.isPublic(PreparedArtwork::class.java.modifiers), "PreparedArtwork is public")
        val constructor = ArtworkAnswer.Bytes::class.java.getConstructor(ByteArray::class.java)
        assertTrue(Modifier.isPublic(constructor.modifiers), "ArtworkAnswer.Bytes has a public constructor")
        assertTrue(Modifier.isPublic(ArtworkFetch::class.java.getMethod("prepare", SessionId::class.java, ArtworkRequest::class.java).modifiers))
    }

    @Test
    fun no_public_type_prints_the_token_the_ids_the_tag_or_the_address() {
        withServer { server ->
            TestSupport.withSession(server.origin, header(CANARY)) { session, _ ->
                val prepared = ArtworkFetch.prepare(session, request)!!
                val answer = prepared.execute(5_000)
                val texts = listOf(request.toString(), prepared.toString(), answer.toString())
                for (text in texts) {
                    for (secret in listOf(CANARY, session.value, itemId, tag, "127.0.0.1", server.port.toString())) {
                        assertFalse(text.contains(secret), "a toString holds a value it must not print")
                    }
                }
            }
        }
    }
}
