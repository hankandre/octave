package dev.octave.session.http

import dev.octave.session.http.TestSupport.authorization
import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.fixture
import dev.octave.session.http.TestSupport.header
import dev.octave.session.http.TestSupport.refused
import dev.octave.session.http.TestSupport.withSession
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory

// T3-03 item 6: plain HTTP is allowed only for hosts the shared host-class vectors call loopback or private LAN, and
// the Kotlin classifier passes packages/core/tests/fixtures/host-classes.json.
class HostClassTest {
    private val servers = TwoServers()

    @AfterEach
    fun closeServers() = servers.close()

    private data class Vector(val url: String, val expected: String)

    private val vectors: List<Vector> =
        fixture("host-classes.json")["vectors"]!!.jsonArray.map {
            val vector = it.jsonObject
            Vector(vector["url"]!!.jsonPrimitive.content, vector["class"]!!.jsonPrimitive.content)
        }

    @TestFactory
    fun the_classifier_gives_each_vector_its_recorded_class(): List<DynamicTest> {
        // The factory itself fails when the fixture shrinks, so a short file cannot pass by running fewer vectors.
        assertTrue(vectors.size >= 94, "host-classes.json holds ${vectors.size} vectors, fewer than 94")
        assertEquals(setOf("loopback", "private-lan", "public"), vectors.map { it.expected }.toSet(), "the fixture's classes")
        return vectors.map { vector ->
            DynamicTest.dynamicTest("${vector.expected}: ${vector.url}") {
                assertEquals(vector.expected, HostClassifier.classifyServerAddress(vector.url).wire, vector.url)
            }
        }
    }

    @Test
    fun a_plain_http_session_to_a_public_host_is_refused() {
        val public = vectors.filter { it.expected == "public" }
        assertTrue(public.isNotEmpty(), "public vectors")
        for (vector in public) {
            assertTrue(vector.url.startsWith("http:"), "every public vector is written with http: (${vector.url})")
            refused(HttpRefusal.PUBLIC_HTTP) { SessionRegistry.open(vector.url, authorization()) }
        }
        servers.assertBReceivedNothing()
    }

    @Test
    fun plain_http_sessions_to_private_lan_and_loopback_hosts_open_without_a_request() {
        for (address in listOf(
            "http://192.168.1.5:8096",
            "http://nas.local:8096",
            "http://[0:0:0:0:0:0:0:1]:8096",
            "http://[::ffff:192.168.1.5]:8096",
        )) {
            val session = SessionRegistry.open(address, authorization())
            SessionRegistry.close(session)
        }
        servers.assertBReceivedNothing()
    }

    @Test
    fun a_loopback_session_works_over_plain_http() {
        withSession(servers.a.origin) { _, factory ->
            assertEquals(200, fetch(factory, servers.a.url("/System/Info")))
        }
        assertEquals(header(), servers.a.requests.single().headers["Authorization"])
        servers.assertBReceivedNothing()
    }

    @Test
    fun https_opens_only_for_a_plain_ascii_address_with_no_user_info() {
        SessionRegistry.close(SessionRegistry.open("https://media.example", authorization()))
        refused(HttpRefusal.INVALID_ADDRESS) { SessionRegistry.open("https://bücher.example", authorization()) }
        refused(HttpRefusal.INVALID_ADDRESS) { SessionRegistry.open("https://user@media.example", authorization()) }
    }

    @Test
    fun an_ipv4_mapped_session_is_pinned_to_the_ipv4_address_okhttp_dials() {
        val port = servers.a.port
        withSession("http://[::ffff:127.0.0.1]:$port", header()) { _, factory ->
            assertEquals(200, fetch(factory, "http://127.0.0.1:$port/x"))
            assertEquals(200, fetch(factory, "http://[::ffff:127.0.0.1]:$port/x"))
        }
        assertEquals(listOf(header(), header()), servers.a.requests.map { it.headers["Authorization"] }, "server A received both requests with the header")
        servers.assertBReceivedNothing()
    }
}
