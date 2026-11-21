package dev.octave.session.http

import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.header
import dev.octave.session.http.TestSupport.mainSources
import dev.octave.session.http.TestSupport.refused
import dev.octave.session.http.TestSupport.repoFile
import dev.octave.session.http.TestSupport.withSession
import okhttp3.Request
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// T3-03 item 1: a native module owns one OkHttp client; every native request in the app uses it.
// "Every native request" is read as Octave's own Kotlin and Java (docs/specs/T3-03.md, Risks, "Item 1's reading").
class OneClientTest {
    private val servers = TwoServers()

    @AfterEach
    fun closeServers() = servers.close()

    @Test
    fun the_client_is_one_instance_across_reads_and_threads() {
        val first = OctaveHttp.client
        assertSame(first, OctaveHttp.client, "a second read returns the same client")
        val pool = Executors.newFixedThreadPool(2)
        try {
            val reads = pool.invokeAll(listOf(Callable { OctaveHttp.client }, Callable { OctaveHttp.client }))
            reads.forEach { assertSame(first, it.get(10, TimeUnit.SECONDS), "a read on another thread returns the same client") }
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun the_client_has_one_interceptor_and_no_network_interceptor() {
        assertEquals(1, OctaveHttp.client.interceptors.size, "application interceptors")
        assertTrue(OctaveHttp.client.networkInterceptors.isEmpty(), "network interceptors")
    }

    @Test
    fun two_sessions_on_two_servers_both_send_through_the_one_client() {
        OctaveHttp.client.connectionPool.evictAll()
        withSession(servers.a.origin, header("CANARY-okhttp-7f3a-a")) { _, factoryA ->
            withSession(servers.b.origin, header("CANARY-okhttp-7f3a-b")) { _, factoryB ->
                assertEquals(200, fetch(factoryA, servers.a.url("/Items")))
                assertEquals(200, fetch(factoryB, servers.b.url("/Items")))
            }
        }
        assertEquals(header("CANARY-okhttp-7f3a-a"), servers.a.requests.single().headers["Authorization"])
        assertEquals(header("CANARY-okhttp-7f3a-b"), servers.b.requests.single().headers["Authorization"])
        assertTrue(OctaveHttp.client.connectionPool.connectionCount() >= 2, "both answers came over the one client's connection pool")
    }

    @Test
    fun a_call_without_a_session_is_refused_and_nothing_is_sent() {
        refused(HttpRefusal.NO_SESSION) {
            OctaveHttp.client.newCall(Request.Builder().url(servers.a.url("/Items")).build()).execute().close()
        }
        val unknown = checkNotNull(SessionId.parse("0123456789abcdef0123456789abcdef")) { "a 32-digit lower-case hex id parses" }
        refused(HttpRefusal.NO_SESSION) { fetch(OctaveHttp.callFactory(unknown), servers.a.url("/Items")) }
        val closed = SessionRegistry.open(servers.a.origin, TestSupport.authorization())
        val factory = OctaveHttp.callFactory(closed)
        SessionRegistry.close(closed)
        refused(HttpRefusal.NO_SESSION) { fetch(factory, servers.a.url("/Items")) }
        assertEquals(0, servers.a.requestCount, "server A's request count")
        assertEquals(0, servers.a.connections, "connections server A accepted")
        servers.assertBReceivedNothing()
    }

    @Test
    fun octave_source_builds_exactly_one_client_and_opens_no_other_connection() {
        // The derived-client pattern must allow Request and Response copies, which the interceptor needs.
        for (text in listOf("client.newBuilder()", "OctaveHttp.client.newBuilder()", "okClient?.newBuilder()", "httpClient().newBuilder()", "Client\n  .newBuilder ()")) {
            assertTrue(DERIVED_CLIENT.containsMatchIn(text), "the pattern matches $text")
        }
        for (text in listOf("request.newBuilder()", "response.newBuilder()", "chain.request().newBuilder()", ".newBuilder(")) {
            assertFalse(DERIVED_CLIENT.containsMatchIn(text), "the pattern does not match $text")
        }

        val modules = repoFile("modules").listFiles().orEmpty().map { File(it, "android/src/main") }
        val files = modules.flatMap { mainSources(it) } + mainSources(repoFile("apps/tv/native"))
        assertTrue(mainSources(TestSupport.sessionHttpMain).isNotEmpty(), "modules/session holds the HTTP package's main source")
        val texts = files.associate { it.invariantSeparatorsPath to it.readText() }

        val builders = texts.values.sumOf { Regex(Regex.escape("OkHttpClient.Builder(")).findAll(it).count() }
        assertEquals(1, builders, "OkHttpClient.Builder( across Octave's main source")
        for (forbidden in listOf("OkHttpClient(", "HttpURLConnection", "openConnection(", "OkHttpClientProvider")) {
            val hits = texts.filterValues { it.contains(forbidden) }.keys
            assertTrue(hits.isEmpty(), "$forbidden appears in $hits")
        }
        val derived = hits(texts, DERIVED_CLIENT)
        assertTrue(derived.isEmpty(), "a derived client appears in $derived")
    }

    private fun hits(texts: Map<String, String>, pattern: Regex) = texts.filterValues { pattern.containsMatchIn(it) }.keys

    private companion object {
        val DERIVED_CLIENT = Regex("""(?i)client\w*\s*(\(\s*\))?\s*\??\s*\.\s*newBuilder\s*\(""")
    }
}
