package dev.octave.session.http

import dev.octave.session.http.ResolverTestSupport.LOOPBACK
import dev.octave.session.http.ResolverTestSupport.PUBLIC
import dev.octave.session.http.ResolverTestSupport.RESOLVED_PUBLIC
import dev.octave.session.http.ResolverTestSupport.address
import dev.octave.session.http.ResolverTestSupport.assertSameList
import dev.octave.session.http.ResolverTestSupport.emptyPool
import dev.octave.session.http.ResolverTestSupport.ipv6
import dev.octave.session.http.ResolverTestSupport.refusedResolvedPublic
import dev.octave.session.http.ResolverTestSupport.table
import dev.octave.session.http.ResolverTestSupport.withAnswers
import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.fixture
import dev.octave.session.http.TestSupport.withSession
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.atomic.AtomicReference

// T3-20 item 2 (docs/specs/T3-20.md): every address in an answer is judged, the connection uses only one that passed,
// and each new connection is judged again.
//
// The table cases call OctaveHttp.client.dns.lookup outside any call, so they are judged and no pool is involved. The
// cases through the client follow the pool rule (own server or an emptied pool, and the resolver's count asserted)
// and dial 127.0.0.1 only.
class ResolvedAddressAnswerTest {
    private val servers = mutableListOf<TestServer>()

    private fun server(): TestServer = TestServer(MockResponse(200, body = "ok")).also {
        it.start()
        servers.add(it)
    }

    @AfterEach
    fun cleanUp() {
        emptyPool()
        servers.forEach { it.close() }
    }

    private fun lookup(name: String): List<InetAddress> = OctaveHttp.client.dns.lookup(name)

    @Test
    fun a_mixed_answer_keeps_only_the_passing_addresses_in_the_resolvers_order() {
        val p1 = PUBLIC
        val private10 = address(10, 0, 0, 5)
        val cgnat = address(100, 64, 0, 1)
        val private192 = address(192, 168, 1, 20)
        val linkLocal = ipv6(0xfe80, 0, 0, 0, 0, 0, 0, 1)
        val google = address(8, 8, 8, 8)
        val ula = ipv6(0xfd00, 0, 0, 0, 0, 0, 0, 5)
        val loopback = LOOPBACK
        val answer = listOf(p1, private10, cgnat, private192, linkLocal, google, ula, loopback)
        withAnswers(table("nas.home.arpa" to answer)) { resolver ->
            assertSameList(listOf(private10, private192, linkLocal, ula, loopback), lookup("nas.home.arpa"), "the passing addresses")
            assertEquals(listOf("nas.home.arpa"), resolver.asked.toList(), "the resolver was asked once")
        }
    }

    @Test
    fun an_answer_with_no_passing_address_is_refused() {
        withAnswers(table("nas.home.arpa" to listOf(PUBLIC, address(8, 8, 8, 8), address(100, 64, 0, 1)))) { resolver ->
            refusedResolvedPublic { lookup("nas.home.arpa") }
            assertEquals(1, resolver.count("nas.home.arpa"), "the resolver was asked once")
        }
    }

    @Test
    fun a_name_that_does_not_resolve_is_the_resolvers_own_failure() {
        val failure = UnknownHostException("made-up failure")
        withAnswers({ _ -> throw failure }) { resolver ->
            val thrown = assertThrows(UnknownHostException::class.java) { lookup("nas.home.arpa") }
            assertSame(failure, thrown, "the resolver's UnknownHostException comes back as itself")
            assertEquals(1, resolver.count("nas.home.arpa"), "the resolver was asked once")
        }
    }

    // --- The IP-literal vectors of host-classes.json, as resolved addresses ----------------------------------------

    private data class Vector(val url: String, val expected: String, val address: InetAddress)

    // The vectors for which HostClassifier.parseServerHost gives an IPv4 or IPv6 address, built from that parsed host's
    // octets or groups alone. Names, and addresses R1 rejects, are never selected.
    private fun ipLiteralVectors(): List<Vector> =
        fixture("host-classes.json")["vectors"]!!.jsonArray.mapNotNull {
            val vector = it.jsonObject
            val url = vector["url"]!!.jsonPrimitive.content
            val expected = vector["class"]!!.jsonPrimitive.content
            when (val host = HostClassifier.parseServerHost(url)) {
                is ParsedHost.Ipv4 -> Vector(url, expected, address(*host.octets))
                is ParsedHost.Ipv6 -> Vector(url, expected, ipv6(*host.groups))
                else -> null
            }
        }

    @TestFactory
    fun each_ip_literal_vector_as_the_only_answer_passes_or_is_refused_by_its_class(): List<DynamicTest> {
        val vectors = ipLiteralVectors()
        val counts = vectors.groupingBy { it.expected }.eachCount()
        val summary = "${vectors.size} selected: ${counts["loopback"] ?: 0} loopback, ${counts["private-lan"] ?: 0} private-lan, ${counts["public"] ?: 0} public"
        // The factory itself fails when the selection shrinks, so a short selection cannot pass by running fewer.
        assertTrue(vectors.size >= 49, "IP-literal vectors: $summary, fewer than 49")
        assertTrue((counts["loopback"] ?: 0) >= 8, "loopback vectors: $summary")
        assertTrue((counts["private-lan"] ?: 0) >= 17, "private-lan vectors: $summary")
        assertTrue((counts["public"] ?: 0) >= 24, "public vectors: $summary")
        return vectors.map { vector ->
            DynamicTest.dynamicTest("${vector.expected}: ${vector.url} ($summary)") {
                withAnswers(table("nas.home.arpa" to listOf(vector.address))) { resolver ->
                    if (vector.expected == "public") {
                        refusedResolvedPublic { lookup("nas.home.arpa") }
                    } else {
                        // Compared with equals: the JDK hands back 4 bytes for IPv4-mapped input.
                        assertEquals(listOf(vector.address), lookup("nas.home.arpa"), vector.url)
                    }
                    assertEquals(1, resolver.count("nas.home.arpa"), "the resolver was asked once")
                }
            }
        }
    }

    // --- localhost passes loopback answers only -------------------------------------------------------------------

    @Test
    fun localhost_passes_loopback_answers_only() {
        val loopback = LOOPBACK
        val lan = address(192, 168, 1, 20)
        val v6Loopback = ipv6(0, 0, 0, 0, 0, 0, 0, 1)
        withAnswers(table("localhost" to listOf(loopback, lan))) {
            assertSameList(listOf(loopback), lookup("localhost"), "localhost keeps its loopback address only")
        }
        withAnswers(table("localhost" to listOf(lan))) { resolver ->
            refusedResolvedPublic { lookup("localhost") }
            assertEquals(1, resolver.count("localhost"), "the resolver was asked once")
        }
        withAnswers(table("localhost" to listOf(v6Loopback))) {
            assertSameList(listOf(v6Loopback), lookup("localhost"), "localhost's ::1 is kept")
        }
    }

    // --- Through the one client ------------------------------------------------------------------------------------

    @Test
    fun a_mixed_answer_through_the_client_connects_to_the_passing_address_only() {
        val server = server()
        val origin = "http://nas.home.arpa:${server.port}"
        withAnswers(table("nas.home.arpa" to listOf(PUBLIC, LOOPBACK))) { resolver ->
            withSession(origin) { _, factory -> assertEquals(200, fetch(factory, "$origin/Items")) }
            assertEquals(1, resolver.count("nas.home.arpa"), "the resolver was asked once")
        }
        assertEquals(1, server.connections, "connections the server accepted")
        assertEquals(1, server.requestCount, "requests the server saw")
    }

    @Test
    fun a_new_connection_is_judged_again_after_the_answer_changes() {
        val server = server()
        val origin = "http://nas.home.arpa:${server.port}"
        val answer = AtomicReference(listOf(LOOPBACK))
        withAnswers({ name -> if (name == "nas.home.arpa") answer.get() else throw UnknownHostException("not in the test table") }) { resolver ->
            withSession(origin) { _, factory ->
                assertEquals(200, fetch(factory, "$origin/Items"), "the first answer is loopback")
                emptyPool()
                answer.set(listOf(PUBLIC))
                val error = assertThrows(OctaveHttpException::class.java) { fetch(factory, "$origin/Items") }
                assertEquals(RESOLVED_PUBLIC, error.refusal.code, "the rebound answer is refused")
            }
            assertEquals(2, resolver.count("nas.home.arpa"), "the resolver was asked for each new connection")
        }
        assertEquals(1, server.requestCount, "requests the server saw")
        assertEquals(1, server.connections, "connections the server accepted")
    }

    @Test
    fun a_kept_alive_connection_is_reused_without_another_lookup() {
        val server = server()
        val origin = "http://nas.home.arpa:${server.port}"
        emptyPool()
        withAnswers(table("nas.home.arpa" to listOf(LOOPBACK))) { resolver ->
            withSession(origin) { _, factory ->
                assertEquals(200, fetch(factory, "$origin/Items/1"))
                assertEquals(200, fetch(factory, "$origin/Items/2"))
            }
            assertEquals(1, resolver.count("nas.home.arpa"), "one lookup for the one connection")
        }
        assertEquals(2, server.requestCount, "requests the server saw")
        assertEquals(1, server.connections, "connections the server accepted")
    }
}
