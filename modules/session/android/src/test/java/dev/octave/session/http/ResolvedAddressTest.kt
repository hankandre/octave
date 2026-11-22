package dev.octave.session.http

import dev.octave.session.http.ResolverTestSupport.LOOPBACK
import dev.octave.session.http.ResolverTestSupport.PUBLIC
import dev.octave.session.http.ResolverTestSupport.address
import dev.octave.session.http.ResolverTestSupport.assertCarriesNothing
import dev.octave.session.http.ResolverTestSupport.emptyPool
import dev.octave.session.http.ResolverTestSupport.ipv6
import dev.octave.session.http.ResolverTestSupport.refusedResolvedPublic
import dev.octave.session.http.ResolverTestSupport.table
import dev.octave.session.http.ResolverTestSupport.withAnswers
import dev.octave.session.http.TestSupport.authorization
import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.header
import dev.octave.session.http.TestSupport.withSession
import dev.octave.session.http.TransportTestSupport.assertError
import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.passwordSignIn
import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signInAnswer
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import dev.octave.session.http.TransportTestSupport.transport
import mockwebserver3.MockResponse
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.InetAddress
import java.util.concurrent.atomic.AtomicReference

// T3-20 item 1 (docs/specs/T3-20.md): for a plain-HTTP session the one OkHttp client connects only to a resolved
// address that the shared host-class rule calls loopback or private LAN; a .local or .home.arpa name with no such
// address is refused before a byte is sent, as a typed refusal that carries no address.
//
// Every case goes through the one client with a fake resolver, has its own server on 127.0.0.1 (a new port, so no
// pooled connection can match), and asserts how many times the resolver was asked for its name. The client is only
// ever allowed to dial 127.0.0.1.
class ResolvedAddressTest {
    private val servers = mutableListOf<TestServer>()

    private fun server(fallback: MockResponse = MockResponse(200, body = "ok")): TestServer =
        TestServer(fallback).also {
            it.start()
            servers.add(it)
        }

    @AfterEach
    fun cleanUp() {
        emptyPool()
        servers.forEach { it.close() }
    }

    @Test
    fun a_private_suffix_name_whose_answer_is_loopback_is_sent_with_the_header() {
        for (name in listOf("nas.home.arpa", "nas.local")) {
            val server = server()
            val origin = "http://$name:${server.port}"
            withAnswers(table(name to listOf(LOOPBACK))) { resolver ->
                withSession(origin) { _, factory -> assertEquals(200, fetch(factory, "$origin/System/Info"), name) }
                assertEquals(1, resolver.count(name), "the resolver was asked for $name once")
            }
            val sent = server.requests.single()
            assertEquals("$name:${server.port}", sent.headers["Host"], "Host")
            assertEquals(header(), sent.headers["Authorization"], "the session's header")
        }
    }

    @Test
    fun a_private_suffix_name_whose_answer_is_public_is_refused_before_a_connection() {
        for (name in listOf("nas.home.arpa", "nas.local")) {
            val server = server()
            val origin = "http://$name:${server.port}"
            withAnswers(table(name to listOf(PUBLIC))) { resolver ->
                withSession(origin) { _, factory -> refusedResolvedPublic { fetch(factory, "$origin/System/Info") } }
                assertEquals(1, resolver.count(name), "the resolver was asked for $name once")
            }
            assertEquals(0, server.connections, "connections the server accepted for $name")
            assertEquals(0, server.requestCount, "requests the server saw for $name")
        }
    }

    @Test
    fun the_refusal_carries_no_address_host_or_port() {
        val name = "nas.home.arpa"
        val server = server()
        val origin = "http://$name:${server.port}"
        val error = withAnswers(table(name to listOf(PUBLIC))) { resolver ->
            val refusal = withSession(origin) { _, factory -> refusedResolvedPublic { fetch(factory, "$origin/Items") } }
            assertEquals(1, resolver.count(name), "the resolver was asked once")
            refusal
        }
        assertCarriesNothing(error, name, "home.arpa", server.port.toString())
        assertEquals(0, server.connections, "connections the server accepted")
    }

    @Test
    fun a_password_sign_in_to_a_name_with_a_public_answer_is_refused_and_the_password_is_not_sent() {
        val name = "nas.home.arpa"
        val server = server(signInAnswer())
        withAnswers(table(name to listOf(PUBLIC))) { resolver ->
            assertError("refused", passwordSignIn("http://$name:${server.port}"))
            assertEquals(1, resolver.count(name), "the resolver was asked once: a refusal is not resent")
        }
        assertEquals(0, server.connections, "connections the server accepted")
        assertEquals(0, server.requestCount, "requests the server saw")
    }

    @Test
    fun a_tokenless_probe_to_a_name_with_a_public_answer_is_refused() {
        val name = "nas.local"
        val server = server(json(200, """{"Id":"server-1"}"""))
        withAnswers(table(name to listOf(PUBLIC))) { resolver ->
            assertError("refused", tokenlessRequest("http://$name:${server.port}", "GET", "/System/Info/Public"))
            assertEquals(1, resolver.count(name), "the resolver was asked once: a refused GET is not resent")
        }
        assertEquals(0, server.connections, "connections the server accepted")
        assertEquals(0, server.requestCount, "requests the server saw")
    }

    @Test
    fun a_logout_whose_name_now_answers_public_is_refused_and_the_session_is_gone() {
        val name = "nas.home.arpa"
        val server = server(json(200, "{}"))
        val answer = AtomicReference(listOf(LOOPBACK))
        withAnswers({ asked -> if (asked == name) answer.get() else throw java.net.UnknownHostException("not in the test table") }) { resolver ->
            val session = SessionRegistry.open("http://$name:${server.port}", authorization())
            assertEquals(200, sessionRequest(session.value, "GET", "/Items")["status"], "the first request answers")
            assertEquals(1, resolver.count(name), "the first request asked the resolver")

            emptyPool()
            answer.set(listOf(PUBLIC))
            assertError("refused", transport.endSession(mapOf("session" to session.value, "timeoutMs" to 5_000.0)))
            assertEquals(2, resolver.count(name), "the logout asked the resolver again")
            assertNull(SessionRegistry.entry(session), "the session is gone")
        }
        assertEquals(listOf("GET /Items"), server.requests.map { "${it.method} ${it.target}" }, "the server saw no logout")
        assertEquals(1, server.connections, "connections the server accepted")
    }

    @Test
    fun other_addresses_outside_the_private_ranges_are_refused_as_the_only_answer() {
        val refused: List<Pair<String, InetAddress>> = listOf(
            "CGNAT 100.64.0.1" to address(100, 64, 0, 1),
            "0.0.0.0" to address(0, 0, 0, 0),
            "::" to ipv6(0, 0, 0, 0, 0, 0, 0, 0),
            "NAT64 64:ff9b::c0a8:101" to ipv6(0x64, 0xff9b, 0, 0, 0, 0, 0xc0a8, 0x101),
            "documentation 2001:db8::1" to ipv6(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1),
        )
        for ((what, address) in refused) {
            val name = "nas.home.arpa"
            val server = server()
            val origin = "http://$name:${server.port}"
            withAnswers(table(name to listOf(address))) { resolver ->
                withSession(origin) { _, factory -> refusedResolvedPublic { fetch(factory, "$origin/Items") } }
                assertEquals(1, resolver.count(name), "$what: the resolver was asked once")
            }
            assertEquals(0, server.connections, "$what: connections the server accepted")
            assertTrue(server.requests.isEmpty(), "$what: requests the server saw")
        }
    }
}
