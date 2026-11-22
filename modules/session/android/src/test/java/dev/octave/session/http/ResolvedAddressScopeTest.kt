package dev.octave.session.http

import dev.octave.session.http.ResolverTestSupport.LOOPBACK
import dev.octave.session.http.ResolverTestSupport.Lookup
import dev.octave.session.http.ResolverTestSupport.PUBLIC
import dev.octave.session.http.ResolverTestSupport.assertFailedNotRefused
import dev.octave.session.http.ResolverTestSupport.assertJudgedAndRefused
import dev.octave.session.http.ResolverTestSupport.assertUnjudged
import dev.octave.session.http.ResolverTestSupport.await
import dev.octave.session.http.ResolverTestSupport.emptyPool
import dev.octave.session.http.ResolverTestSupport.httpsAttempt
import dev.octave.session.http.ResolverTestSupport.reenter
import dev.octave.session.http.ResolverTestSupport.refusedResolvedPublic
import dev.octave.session.http.ResolverTestSupport.waitSeconds
import dev.octave.session.http.ResolverTestSupport.withAnswers
import dev.octave.session.http.TestSupport.authorization
import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.mainSources
import dev.octave.session.http.TestSupport.repoFile
import dev.octave.session.http.TestSupport.withSession
import dev.octave.session.http.TransportTestSupport.assertError
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import mockwebserver3.MockResponse
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dns
import okhttp3.Request
import okhttp3.Response
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

// T3-20 item 3 (docs/specs/T3-20.md): decision 0001's literal-host classification is unchanged and still runs first;
// an IP-literal host and an HTTPS session behave as before.
//
// The HTTPS twin ("The HTTPS twin"): the fake resolver answers tls.home.arpa and plain.home.arpa with [127.0.0.1] and
// outside.home.arpa with [203.0.113.7]. When it is asked for tls or plain it first re-enters the rule with a lookup
// of outside.home.arpa on the thread it is on, which no call is waiting on. Inside an HTTPS call that lookup comes
// back whole (not judged); inside a plain-HTTP call it is refused. Every call dials 127.0.0.1 only.
class ResolvedAddressScopeTest {
    private val servers = mutableListOf<TestServer>()
    private val workers = Executors.newFixedThreadPool(2)

    private fun server(): TestServer = TestServer(MockResponse(200, body = "ok")).also {
        it.start()
        servers.add(it)
    }

    @AfterEach
    fun cleanUp() {
        workers.shutdownNow()
        emptyPool()
        servers.forEach { it.close() }
    }

    // The twin's fake: tls and plain answer loopback after a re-entered lookup of outside, recorded by name.
    private class TwinAnswers {
        val reentries = java.util.concurrent.ConcurrentHashMap<String, Lookup>()

        fun answer(name: String): List<InetAddress> = when (name) {
            "tls.home.arpa", "plain.home.arpa" -> {
                reentries[name] = reenter("outside.home.arpa")
                listOf(LOOPBACK)
            }
            "outside.home.arpa", "refused.home.arpa" -> listOf(PUBLIC)
            else -> throw UnknownHostException("not in the test table")
        }
    }

    // --- Decision 0001 runs first --------------------------------------------------------------------------------

    @Test
    fun a_public_name_over_plain_http_is_still_public_http_and_never_resolved() {
        withAnswers({ _ -> fail<List<InetAddress>>("the resolver was asked for a public name") }) { resolver ->
            for (address in listOf("http://nas.lan:8096", "http://nas")) {
                val error = org.junit.jupiter.api.Assertions.assertThrows(OctaveHttpException::class.java) {
                    SessionRegistry.open(address, authorization())
                }
                assertEquals("public-http", error.refusal.code, address)
                assertError("refused", tokenlessRequest(address, "GET", "/System/Info/Public"))
            }
            assertEquals(emptyList<String>(), resolver.asked.toList(), "names the resolver was asked")
        }
    }

    @Test
    fun an_ip_literal_session_never_asks_the_resolver() {
        val server = server()
        withAnswers({ _ -> fail<List<InetAddress>>("the resolver was asked for an IP literal") }) { resolver ->
            withSession(server.origin) { _, factory -> assertEquals(200, fetch(factory, server.url("/Items"))) }
            assertEquals(0, resolver.asked.size, "names the resolver was asked")
        }
        assertEquals(1, server.requestCount, "requests the server saw")
    }

    @Test
    fun the_one_client_has_its_own_dns_and_still_one_interceptor() {
        assertNotSame(Dns.SYSTEM, OctaveHttp.client.dns, "the one client's Dns is the resolved-address rule, not Dns.SYSTEM")
        assertEquals(1, OctaveHttp.client.interceptors.size, "application interceptors")
        assertTrue(OctaveHttp.client.networkInterceptors.isEmpty(), "network interceptors")
    }

    // --- The HTTPS twin ------------------------------------------------------------------------------------------

    @Test
    fun an_https_calls_lookups_are_not_judged_on_execute() {
        val server = server()
        val twin = TwinAnswers()
        val origin = "https://tls.home.arpa:${server.port}"
        withAnswers(twin::answer) { resolver ->
            val error = withSession(origin) { _, factory -> httpsAttempt(factory, "$origin/Items") }
            assertFailedNotRefused(error, "execute")
            assertEquals(1, resolver.count("tls.home.arpa"), "the resolver was asked for tls.home.arpa")
        }
        assertTrue(server.connections >= 1, "the HTTPS call connected to the server (${server.connections})")
        assertTrue(server.requests.none { it.headers["Authorization"] != null }, "no request carried the header")
        assertUnjudged(twin.reentries["tls.home.arpa"], "the lookup inside the HTTPS call")
    }

    @Test
    fun an_https_calls_lookups_are_not_judged_on_enqueue() {
        val server = server()
        val twin = TwinAnswers()
        val origin = "https://tls.home.arpa:${server.port}"
        withAnswers(twin::answer) { resolver ->
            val outcome = AtomicReference<Throwable?>()
            val done = CountDownLatch(1)
            withSession(origin) { _, factory ->
                val call = factory.newCall(Request.Builder().url("$origin/Items").build())
                call.timeout().timeout(waitSeconds, TimeUnit.SECONDS)
                call.enqueue(object : Callback {
                    override fun onFailure(call: Call, e: IOException) {
                        outcome.set(e)
                        done.countDown()
                    }

                    override fun onResponse(call: Call, response: Response) {
                        response.close()
                        done.countDown()
                    }
                })
                // Wait for the callback before leaving withAnswers, so the fake stays in place for the whole call.
                assertTrue(done.await(waitSeconds + 5, TimeUnit.SECONDS), "the enqueued call finished")
            }
            assertFailedNotRefused(outcome.get(), "enqueue")
            assertEquals(1, resolver.count("tls.home.arpa"), "the resolver was asked for tls.home.arpa")
        }
        assertTrue(server.connections >= 1, "the HTTPS call connected to the server (${server.connections})")
        assertTrue(server.requests.none { it.headers["Authorization"] != null }, "no request carried the header")
        assertUnjudged(twin.reentries["tls.home.arpa"], "the lookup inside the enqueued HTTPS call")
    }

    @Test
    fun a_plain_http_calls_lookups_are_judged() {
        val server = server()
        val twin = TwinAnswers()
        val origin = "http://plain.home.arpa:${server.port}"
        withAnswers(twin::answer) { resolver ->
            withSession(origin) { _, factory -> assertEquals(200, fetch(factory, "$origin/Items")) }
            assertEquals(1, resolver.count("plain.home.arpa"), "the resolver was asked for plain.home.arpa")
        }
        assertEquals(1, server.requestCount, "requests the server saw")
        assertJudgedAndRefused(twin.reentries["plain.home.arpa"], "the lookup inside the plain-HTTP call")
    }

    @Test
    fun a_lookup_outside_any_call_is_judged() {
        withAnswers(TwinAnswers()::answer) { resolver ->
            assertJudgedAndRefused(reenter("outside.home.arpa"), "a lookup with no call")
            assertEquals(1, resolver.count("outside.home.arpa"), "the resolver was asked for outside.home.arpa")
        }
    }

    // --- Concurrency and nesting ---------------------------------------------------------------------------------

    @Test
    fun a_plain_http_call_on_another_thread_is_judged_while_an_https_call_is_in_its_lookup() {
        val tlsServer = server()
        val refusedServer = server()
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val before = AtomicReference<Lookup>()
        val after = AtomicReference<Lookup>()
        val answers = { name: String ->
            when (name) {
                "tls.home.arpa" -> {
                    before.set(reenter("outside.home.arpa"))
                    entered.countDown()
                    release.await(waitSeconds, TimeUnit.SECONDS)
                    after.set(reenter("outside.home.arpa"))
                    listOf(LOOPBACK)
                }
                "refused.home.arpa", "outside.home.arpa" -> listOf(PUBLIC)
                else -> throw UnknownHostException("not in the test table")
            }
        }
        val tlsOrigin = "https://tls.home.arpa:${tlsServer.port}"
        val refusedOrigin = "http://refused.home.arpa:${refusedServer.port}"
        withAnswers(answers) { resolver ->
            withSession(tlsOrigin) { _, tlsFactory ->
                withSession(refusedOrigin) { _, refusedFactory ->
                    val https = workers.submit<Throwable?> { httpsAttempt(tlsFactory, "$tlsOrigin/Items") }
                    try {
                        await(entered, "the HTTPS call to reach its lookup")
                        val plain = workers.submit<Unit> { refusedResolvedPublic { fetch(refusedFactory, "$refusedOrigin/Items") } }
                        plain.get(waitSeconds, TimeUnit.SECONDS)
                    } finally {
                        release.countDown()
                    }
                    assertFailedNotRefused(https.get(waitSeconds + 5, TimeUnit.SECONDS), "the HTTPS call")
                }
            }
            assertEquals(1, resolver.count("tls.home.arpa"), "the resolver was asked for tls.home.arpa")
            assertEquals(1, resolver.count("refused.home.arpa"), "the resolver was asked for refused.home.arpa")
        }
        assertEquals(0, refusedServer.connections, "connections the plain-HTTP call's server accepted")
        assertUnjudged(before.get(), "the HTTPS thread's lookup before the plain-HTTP call")
        assertUnjudged(after.get(), "the HTTPS thread's lookup after the plain-HTTP call")
    }

    @Test
    fun a_plain_http_call_nested_inside_an_https_lookup_is_judged_and_restores_the_https_mark() {
        val tlsServer = server()
        val refusedServer = server()
        val tlsOrigin = "https://tls.home.arpa:${tlsServer.port}"
        val refusedOrigin = "http://refused.home.arpa:${refusedServer.port}"
        val inner = AtomicReference<Throwable?>()
        val afterInner = AtomicReference<Lookup>()
        val refusedSession = SessionRegistry.open(refusedOrigin, authorization())
        try {
            val refusedFactory = OctaveHttp.callFactory(refusedSession)
            val answers = { name: String ->
                when (name) {
                    "tls.home.arpa" -> {
                        inner.set(runCatching { fetch(refusedFactory, "$refusedOrigin/Items") }.exceptionOrNull())
                        afterInner.set(reenter("outside.home.arpa"))
                        listOf(LOOPBACK)
                    }
                    "refused.home.arpa", "outside.home.arpa" -> listOf(PUBLIC)
                    else -> throw UnknownHostException("not in the test table")
                }
            }
            withAnswers(answers) { resolver ->
                val error = withSession(tlsOrigin) { _, factory -> httpsAttempt(factory, "$tlsOrigin/Items") }
                assertFailedNotRefused(error, "the outer HTTPS call")
                assertEquals(1, resolver.count("tls.home.arpa"), "the resolver was asked for tls.home.arpa")
                assertEquals(1, resolver.count("refused.home.arpa"), "the resolver was asked for refused.home.arpa")
            }
        } finally {
            SessionRegistry.close(refusedSession)
        }
        val innerError = inner.get()
        assertTrue(innerError is OctaveHttpException, "the inner plain-HTTP call was refused, not ${innerError?.javaClass?.name}")
        assertEquals(ResolverTestSupport.RESOLVED_PUBLIC, (innerError as OctaveHttpException).refusal.code, "the inner refusal's code")
        assertEquals(0, refusedServer.connections, "connections the inner call's server accepted")
        assertUnjudged(afterInner.get(), "the HTTPS thread's lookup after the inner plain-HTTP call returned")
    }

    @Test
    fun an_https_call_nested_inside_a_plain_http_lookup_leaves_no_mark_behind() {
        val plainServer = server()
        val tlsServer = server()
        val plainOrigin = "http://plain.home.arpa:${plainServer.port}"
        val tlsOrigin = "https://tls.home.arpa:${tlsServer.port}"
        val inner = AtomicReference<Throwable?>()
        val afterInner = AtomicReference<Lookup>()
        val tlsSession = SessionRegistry.open(tlsOrigin, authorization())
        try {
            val tlsFactory = OctaveHttp.callFactory(tlsSession)
            val answers = { name: String ->
                when (name) {
                    "plain.home.arpa" -> {
                        inner.set(httpsAttempt(tlsFactory, "$tlsOrigin/Items"))
                        afterInner.set(reenter("outside.home.arpa"))
                        listOf(LOOPBACK)
                    }
                    "tls.home.arpa" -> listOf(LOOPBACK)
                    "outside.home.arpa" -> listOf(PUBLIC)
                    else -> throw UnknownHostException("not in the test table")
                }
            }
            withAnswers(answers) { resolver ->
                withSession(plainOrigin) { _, factory -> assertEquals(200, fetch(factory, "$plainOrigin/Items"), "the outer plain-HTTP call") }
                assertEquals(1, resolver.count("plain.home.arpa"), "the resolver was asked for plain.home.arpa")
                assertEquals(1, resolver.count("tls.home.arpa"), "the resolver was asked for tls.home.arpa")
            }
        } finally {
            SessionRegistry.close(tlsSession)
        }
        assertFailedNotRefused(inner.get(), "the inner HTTPS call")
        assertTrue(tlsServer.connections >= 1, "the inner HTTPS call connected (${tlsServer.connections})")
        assertJudgedAndRefused(afterInner.get(), "the plain-HTTP thread's lookup after the inner HTTPS call returned")
        assertEquals(1, plainServer.requestCount, "requests the outer call's server saw")
    }

    // --- The seam stays test-only --------------------------------------------------------------------------------

    @Test
    fun the_scan_catches_main_source_that_names_the_seam() {
        val planted = mapOf(
            "modules/session/android/src/main/java/dev/octave/session/http/OctaveHttp.kt" to "ResolvedAddressRule.withResolver(fake) { send() }",
            "modules/session/android/src/main/java/dev/octave/session/OctaveSessionModule.kt" to "val seam = rule::withResolver",
            "apps/tv/native/Probe.kt" to "dns.javaClass.methods.first { it.name.startsWith(\"withResolver\") }",
        )
        for ((path, text) in planted) assertEquals(listOf(path), violations(mapOf(path to text)), "the scan catches $text")
        assertEquals(emptyList<String>(), violations(mapOf("modules/session/android/src/main/java/dev/octave/session/http/$RULE_FILE" to "fun <T> withResolver(")))
    }

    @Test
    fun no_main_source_but_the_rule_names_the_seam() {
        val modules = repoFile("modules").listFiles().orEmpty().map { File(it, "android/src/main") }
        val files = modules.flatMap { mainSources(it) } + mainSources(repoFile("apps/tv/native"))
        val rule = files.filter { it.name == RULE_FILE }
        assertEquals(1, rule.size, "the scan reads $RULE_FILE in main source")
        assertTrue(rule.single().readText().contains(SEAM), "$RULE_FILE defines the seam")
        val texts = files.associate { it.invariantSeparatorsPath.removePrefix(repoFile("").invariantSeparatorsPath + "/") to it.readText() }
        assertEquals(emptyList<String>(), violations(texts), "main source that names the seam")
    }

    private fun violations(texts: Map<String, String>): List<String> =
        texts.filter { (path, text) -> path.substringAfterLast('/') != RULE_FILE && text.contains(SEAM) }.keys.toList()

    private companion object {
        const val RULE_FILE = "ResolvedAddressRule.kt"
        const val SEAM = "withResolver"
    }
}
