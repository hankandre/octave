package dev.octave.session.http

import dev.octave.session.http.ResolverTestSupport.LOOPBACK
import dev.octave.session.http.ResolverTestSupport.emptyPool
import dev.octave.session.http.ResolverTestSupport.withResolver
import dev.octave.session.http.TransportTestSupport.DEVICE_ID
import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.passwordSignIn
import dev.octave.session.http.TransportTestSupport.signInAnswer
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import dev.octave.session.http.TransportTestSupport.transport
import okhttp3.Dns
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.function.Executable
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.CopyOnWriteArrayList

// T3-25 item 2 (docs/specs/T3-25.md, "The two errors"): a StackOverflowError or an OutOfMemoryError raised inside a
// transport call resolves exactly { error: "unexpected-response" }: one key, so no message, class name or other value
// crosses. An OutOfMemoryError is caught on the calling thread, mapped the same way and never re-sent.
//
// - The mapping by type, with controls that keep network.
// - Through the one client: the resolver seam T3-20 left (ResolverTestSupport.withResolver) makes the one client's Dns
//   raise the error inside call.execute(), on the calling thread, for a tokenless GET (a call send may resend) and a
//   password sign-in. Each case asserts the resolver was asked exactly once (spec-check note 7) and the server saw no
//   request. A real StackOverflowError comes from a bare recursion in this file, after one ordinary call through the
//   client (spec-check note 4).
// - With no client: an argument map whose get throws, for each of the three functions.
//
// What this does not show (spec-check note 1): the error raised while the answer's body is read or parsed. No seam
// reaches those steps; they run inside the same outcome block as the lookup, and the code is decided by type alone.
class ParserErrorCodeTest {
    private val server = PathServer()

    @AfterEach
    fun cleanUp() {
        emptyPool()
        server.close()
    }

    private val one = mapOf("error" to "unexpected-response")

    // A message a leak would show: a made-up URL with a made-up credential parameter.
    private val detail = "http://media.example:8096/Items?api_key=made-up-0001"

    // Recurses until the JVM raises a real StackOverflowError. Nothing at depth calls a library.
    private fun bottomless(depth: Int): Int = bottomless(depth + 1) + 1

    // A resolver that records each name it is asked and then raises the error `raise` gives.
    private class RaisingResolver(private val raise: () -> Nothing) : Dns {
        val asked = CopyOnWriteArrayList<String>()

        override fun lookup(hostname: String): List<InetAddress> {
            asked.add(hostname)
            raise()
        }
    }

    private fun errors(): List<Pair<String, () -> Nothing>> = listOf(
        "StackOverflowError" to {
            bottomless(0)
            throw IllegalStateException("unreachable")
        },
        "OutOfMemoryError" to { throw OutOfMemoryError(detail) },
    )

    private fun origin(): String = "http://$NAME:${server.port}"

    // One ordinary call through the one client to the same name, so every class on the send path is loaded before
    // the stack is driven to its edge. Then the pool is emptied, so the next call asks the resolver again.
    private fun warmUp() {
        server.answer("/System/Info/Public") { json(200, """{"Id":"server-1"}""") }
        val asked = CopyOnWriteArrayList<String>()
        val loopback = object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                asked.add(hostname)
                if (hostname != NAME) throw UnknownHostException("not in the test table")
                return listOf(LOOPBACK)
            }
        }
        val result = withResolver(loopback) { tokenlessRequest(origin(), "GET", "/System/Info/Public") }
        assertEquals(mapOf("status" to 200, "body" to """{"Id":"server-1"}"""), result, "the warm-up call crosses")
        assertEquals(listOf(NAME), asked.toList(), "the warm-up call asked the resolver once")
        emptyPool()
    }

    // An argument map with the expected keys whose get raises the error. Its entries are plain, so the key check
    // passes and the first read of a value raises.
    private fun raisingArgs(keys: Map<String, Any?>, raise: () -> Nothing): Map<String, Any?> = object : AbstractMap<String, Any?>() {
        override val entries: Set<Map.Entry<String, Any?>> = keys.entries

        override fun get(key: String): Any? = raise()

        override fun containsKey(key: String): Boolean = keys.containsKey(key)
    }

    @Test
    fun a_stack_overflow_and_an_out_of_memory_error_map_to_unexpected_response() {
        assertAll(
            Executable { assertEquals("unexpected-response", TransportCodes.of(StackOverflowError()), "StackOverflowError") },
            Executable { assertEquals("unexpected-response", TransportCodes.of(OutOfMemoryError("detail")), "OutOfMemoryError") },
        )
    }

    // Controls, green on main: a rule that maps every Error, or everything, fails here.
    @Test
    fun another_exception_and_another_error_keep_network() {
        assertEquals("network", TransportCodes.of(IllegalStateException("boom")), "IllegalStateException")
        assertEquals("network", TransportCodes.of(LinkageError("boom")), "LinkageError")
    }

    // A tokenless GET is a call send may resend, so exactly one lookup shows the error was not re-sent.
    private fun tokenlessGetIsUnexpected(name: String, raise: () -> Nothing) {
        warmUp()
        val before = server.requests.size
        val resolver = RaisingResolver(raise)
        val result = withResolver(resolver) { tokenlessRequest(origin(), "GET", "/System/Info/Public") }
        assertEquals(listOf(NAME), resolver.asked.toList(), "$name: the resolver was asked exactly once, so the GET was not resent")
        assertEquals(before, server.requests.size, "$name: the server saw no request")
        assertEquals(one, result, "$name: tokenless GET")
    }

    private fun passwordSignInIsUnexpected(name: String, raise: () -> Nothing) {
        warmUp()
        server.answer("/Users/AuthenticateByName") { signInAnswer() }
        val before = server.requests.size
        val resolver = RaisingResolver(raise)
        val result = withResolver(resolver) { passwordSignIn(origin()) }
        (result["session"] as? String)?.let { SessionId.parse(it) }?.let { SessionRegistry.close(it) }
        assertEquals(listOf(NAME), resolver.asked.toList(), "$name: the resolver was asked exactly once")
        assertEquals(before, server.requests.size, "$name: the server saw no request")
        assertEquals(one, result, "$name: password sign-in")
    }

    private fun raiseOf(name: String): () -> Nothing = errors().single { it.first == name }.second

    // The premise of the four cases below, green on main: the one client hands an Error its Dns raised to the caller
    // of execute() unchanged, the very object, not wrapped.
    @Test
    fun the_one_client_hands_an_error_from_its_dns_to_the_caller_unchanged() {
        warmUp()
        val error = OutOfMemoryError(detail)
        val thrown = withResolver(RaisingResolver { throw error }) {
            TestSupport.withSession(origin()) { _, factory ->
                try {
                    TestSupport.fetch(factory, "${origin()}/Items")
                    null
                } catch (raised: Throwable) {
                    raised
                }
            }
        }
        assertSame(error, thrown, "the caller of execute() got the very error the Dns raised")
    }

    @Test
    fun a_stack_overflow_in_a_tokenless_get_through_the_one_client_is_unexpected_response_and_not_resent() =
        tokenlessGetIsUnexpected("StackOverflowError", raiseOf("StackOverflowError"))

    @Test
    fun an_out_of_memory_error_in_a_tokenless_get_through_the_one_client_is_unexpected_response_and_not_resent() =
        tokenlessGetIsUnexpected("OutOfMemoryError", raiseOf("OutOfMemoryError"))

    @Test
    fun a_stack_overflow_in_a_password_sign_in_through_the_one_client_is_unexpected_response() =
        passwordSignInIsUnexpected("StackOverflowError", raiseOf("StackOverflowError"))

    @Test
    fun an_out_of_memory_error_in_a_password_sign_in_through_the_one_client_is_unexpected_response() =
        passwordSignInIsUnexpected("OutOfMemoryError", raiseOf("OutOfMemoryError"))

    @Test
    fun each_error_raised_in_end_session_arguments_is_unexpected_response() {
        assertAll(
            errors().map { (name, raise) ->
                Executable {
                    val args = raisingArgs(mapOf("session" to "s", "timeoutMs" to 5_000.0), raise)
                    assertEquals(one, transport.endSession(args), "$name: endSession")
                }
            },
        )
    }

    @Test
    fun each_error_raised_in_sign_in_and_request_arguments_is_unexpected_response() {
        val signInKeys = mapOf(
            "server" to server.origin,
            "deviceId" to DEVICE_ID,
            "kind" to "password",
            "username" to "louise",
            "password" to "placeholder-pw",
            "timeoutMs" to 5_000.0,
        )
        val requestKeys = mapOf("server" to server.origin, "deviceId" to DEVICE_ID, "method" to "GET", "path" to "/System/Info/Public", "timeoutMs" to 5_000.0)
        assertAll(
            errors().flatMap { (name, raise) ->
                listOf(
                    Executable { assertEquals(one, transport.signIn(raisingArgs(signInKeys, raise)), "$name: signIn") },
                    Executable { assertEquals(one, transport.request(raisingArgs(requestKeys, raise)), "$name: request") },
                )
            },
        )
        assertEquals(0, server.requests.size, "the server saw no request")
    }

    private companion object {
        const val NAME = "nas.home.arpa"
    }
}
