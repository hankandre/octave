package dev.octave.session.http

import dev.octave.session.http.ResolverTestSupport.LOOPBACK
import dev.octave.session.http.ResolverTestSupport.table
import dev.octave.session.http.ResolverTestSupport.withAnswers
import dev.octave.session.http.TransportTestSupport.DEVICE_ID
import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.signInAnswer
import mockwebserver3.MockResponse
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test

// T3-33 item 1 (docs/specs/T3-33.md, "The rule", "Where it is asked", Test plan): in a development build
// (DevelopmentServers.forBuild(true, ...)) the native session module sends nothing to a server whose host is not
// loopback, the emulator host 10.0.2.2, or an entry of the build-time allowlist. The refusal is
// HttpRefusal.DEVELOPMENT_BUILD, it happens before any request, it crosses as exactly { error: "refused" }, and it
// carries no address. No case reads BuildConfig or the environment: the allowlist is handed in as text.
//
// Every address is a documentation or reserved address (.example, .invalid, .home.arpa, .local, TEST-NET, 10.0.2.2)
// or an arbitrary private address that names no real server. The mock server listens on 127.0.0.1, and the name
// media.home.arpa is pointed at it through the one client's resolver seam (ResolverTestSupport, T3-20).
class DevelopmentBuildRefusalTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    private fun dev(allowlist: String = ""): DevelopmentServers = DevelopmentServers.forBuild(true, allowlist)

    private fun admitted(servers: DevelopmentServers, url: String) {
        val address = ServerAddress.parse(url)
        try {
            servers.check(address)
        } catch (error: OctaveHttpException) {
            fail<Unit>("$url was refused with ${error.refusal.code}; it must be admitted")
        }
    }

    private fun refused(servers: DevelopmentServers, url: String): OctaveHttpException {
        val address = ServerAddress.parse(url)
        val error = assertThrows(OctaveHttpException::class.java, { servers.check(address) }, "$url must be refused")
        assertEquals(HttpRefusal.DEVELOPMENT_BUILD, error.refusal, "$url: the refusal")
        return error
    }

    // --- The rule ---

    @Test
    fun an_empty_allowlist_admits_loopback_and_the_emulator_host() {
        val servers = dev("")
        for (url in ADMITTED_WITHOUT_A_LIST) admitted(servers, url)
    }

    @Test
    fun an_empty_allowlist_refuses_every_other_host() {
        val servers = dev("")
        for (url in REFUSED_WITHOUT_A_LIST) refused(servers, url)
    }

    @Test
    fun another_spelling_of_an_ipv4_address_never_dodges_the_rule() {
        val servers = dev("")
        // Both are 10.0.2.3: refused, by ServerAddress.parse or by the rule.
        for (url in listOf("http://0x0a000203", "http://10.0.515")) {
            val error = assertThrows(OctaveHttpException::class.java, { servers.check(ServerAddress.parse(url)) }, "$url must be refused")
            assertTrue(
                error.refusal == HttpRefusal.INVALID_ADDRESS || error.refusal == HttpRefusal.DEVELOPMENT_BUILD,
                "$url: refused as invalid-address or development-build, not ${error.refusal.code}",
            )
        }
        // Both are 10.0.2.2: admitted, or refused by ServerAddress.parse, never by the rule.
        for (url in listOf("http://0x0a000202", "http://10.0.514")) {
            try {
                servers.check(ServerAddress.parse(url))
            } catch (error: OctaveHttpException) {
                assertEquals(HttpRefusal.INVALID_ADDRESS, error.refusal, "$url: only ServerAddress.parse may refuse it")
            }
        }
    }

    @Test
    fun a_listed_host_is_admitted_in_any_letter_case_and_with_any_port() {
        val servers = dev("media.home.arpa, 10.1.2.3,[fd00::1]")
        for (url in listOf(
            "http://media.home.arpa",
            "http://media.home.arpa:8096",
            "http://MEDIA.Home.Arpa:8096",
            "https://media.home.arpa:8920",
            "http://10.1.2.3",
            "http://10.1.2.3:8096",
            "https://10.1.2.3:8920",
            "http://[fd00::1]",
            "http://[FD00::1]:8096",
            "http://[fd00:0:0:0:0:0:0:1]:8096",
        )) {
            admitted(servers, url)
        }
    }

    @Test
    fun a_listed_host_admits_nothing_beside_itself_and_loopback_and_the_emulator_host_still_qualify() {
        val servers = dev("media.home.arpa, 10.1.2.3,[fd00::1]")
        for (url in listOf("http://sub.media.home.arpa", "https://media.home.arpa.example", "http://10.1.2.4", "http://[fd00::2]")) {
            refused(servers, url)
        }
        for (url in ADMITTED_WITHOUT_A_LIST) admitted(servers, url)
    }

    @Test
    fun an_allowlist_entry_that_is_not_one_exact_host_admits_nothing() {
        val entries = listOf("", " ", ",", "*", "*.home.arpa", "10.1.2.0/24", "http://media.home.arpa", "media.home.arpa:8096", "media.home.arpa/path", "media home.arpa", "10.1.2.3 media.home.arpa")
        for (entry in entries) {
            val servers = dev(entry)
            for (url in listOf("http://media.home.arpa", "http://10.1.2.3")) {
                val address = ServerAddress.parse(url)
                val error = assertThrows(OctaveHttpException::class.java, { servers.check(address) }, "with the list \"$entry\", $url must be refused")
                assertEquals(HttpRefusal.DEVELOPMENT_BUILD, error.refusal, "with the list \"$entry\", $url: the refusal")
            }
            admitted(servers, "http://127.0.0.1:8096")
            admitted(servers, "http://10.0.2.2:8096")
        }
    }

    @Test
    fun a_listed_public_name_does_not_lift_the_plain_http_rule() {
        val servers = dev("media.example")
        val error = assertThrows(OctaveHttpException::class.java) { servers.check(ServerAddress.parse("http://media.example")) }
        assertEquals(HttpRefusal.PUBLIC_HTTP, error.refusal, "plain HTTP to a public name stays refused by ServerAddress.parse")
        admitted(servers, "https://media.example")
    }

    @Test
    fun the_refusal_carries_its_code_only_and_the_rule_prints_no_entry() {
        val servers = dev("media.home.arpa,10.1.2.3,[fd00::1]")
        val error = refused(servers, "https://media.example:8920")
        assertEquals("development-build", error.message, "the message is exactly the code")
        assertNull(error.cause, "the refusal has no cause")
        for (text in listOf(error.toString(), error.message.orEmpty())) {
            for (secret in listOf("media.example", "8920")) assertFalse(text.contains(secret), "the refusal holds $secret")
        }
        val printed = servers.toString()
        for (entry in listOf("media.home.arpa", "10.1.2.3", "fd00")) assertFalse(printed.contains(entry), "toString() of the rule holds $entry")
    }

    // --- Through SessionTransport ---

    private fun transport(allowlist: String): SessionTransport = SessionTransport(ClientIdentity.of("Octave Test TV", "0.0.0"), dev(allowlist))

    private fun passwordSignIn(transport: SessionTransport, url: String): Map<String, Any?> = transport.signIn(
        mapOf("server" to url, "deviceId" to DEVICE_ID, "kind" to "password", "username" to "louise", "password" to "placeholder-pw", "timeoutMs" to 5_000.0),
    )

    private fun quickConnectSignIn(transport: SessionTransport, url: String): Map<String, Any?> = transport.signIn(
        mapOf("server" to url, "deviceId" to DEVICE_ID, "kind" to "quick-connect", "secret" to "placeholder-secret", "timeoutMs" to 5_000.0),
    )

    private fun tokenless(transport: SessionTransport, url: String, method: String, path: String): Map<String, Any?> {
        val body = if (method == "POST") mapOf("body" to "{}") else emptyMap()
        return transport.request(mapOf("server" to url, "deviceId" to DEVICE_ID, "method" to method, "path" to path, "timeoutMs" to 5_000.0) + body)
    }

    private fun answerEverything() {
        server.answer("/Users/AuthenticateByName") { signInAnswer() }
        server.answer("/Users/AuthenticateWithQuickConnect") { signInAnswer() }
        server.answer("/Users/Me") { json(200, """{"Id":"user-1"}""") }
        server.answer("/Sessions/Logout") { MockResponse(204) }
        for ((_, path) in RequestPolicy.PRE_SIGN_IN_ROUTES) server.answer(path) { json(200, "{}") }
    }

    private fun assertRefusedAndSilent(result: Map<String, Any?>, what: String) {
        assertEquals(mapOf("error" to "refused"), result, "$what: the result")
        assertFalse(result.toString().contains("media.home.arpa"), "$what: the result holds the host")
        assertFalse(result.toString().contains(server.port.toString()), "$what: the result holds the port")
    }

    @Test
    fun an_empty_allowlist_refuses_a_sign_in_to_a_home_network_name_before_any_request() {
        answerEverything()
        val transport = transport("")
        val url = "http://media.home.arpa:${server.port}"
        withAnswers(table("media.home.arpa" to listOf(LOOPBACK))) { resolver ->
            val before = SessionRegistry.count()
            assertRefusedAndSilent(passwordSignIn(transport, url), "password sign-in")
            assertRefusedAndSilent(quickConnectSignIn(transport, url), "Quick Connect sign-in")
            assertEquals(before, SessionRegistry.count(), "no session was opened")
            assertEquals(emptyList<String>(), resolver.asked.toList(), "the resolver was asked nothing")
        }
        assertEquals(0, server.requests.size, "no request reached the server")
    }

    @Test
    fun an_empty_allowlist_refuses_every_call_before_sign_in_to_a_home_network_name() {
        answerEverything()
        val transport = transport("")
        val url = "http://media.home.arpa:${server.port}"
        withAnswers(table("media.home.arpa" to listOf(LOOPBACK))) { resolver ->
            for ((method, path) in RequestPolicy.PRE_SIGN_IN_ROUTES) {
                assertRefusedAndSilent(tokenless(transport, url, method, path), "$method $path")
            }
            assertEquals(emptyList<String>(), resolver.asked.toList(), "the resolver was asked nothing")
        }
        assertEquals(0, server.requests.size, "no request reached the server")
    }

    @Test
    fun a_listed_name_signs_in_and_its_session_works() {
        answerEverything()
        val transport = transport("media.home.arpa")
        val url = "http://media.home.arpa:${server.port}"
        withAnswers(table("media.home.arpa" to listOf(LOOPBACK))) { _ ->
            val signedIn = passwordSignIn(transport, url)
            val session = signedIn["session"] as? String
            assertNotNull(session, "the sign-in returned a session, not ${signedIn["error"]}")
            val me = transport.request(mapOf("session" to session, "method" to "GET", "path" to "/Users/Me", "timeoutMs" to 5_000.0))
            assertEquals(200, me["status"], "a session request works")
            assertEquals(emptyMap<String, Any?>(), transport.endSession(mapOf("session" to session, "timeoutMs" to 5_000.0)), "endSession works")
        }
        assertEquals(listOf("POST /Users/AuthenticateByName", "GET /Users/Me", "POST /Sessions/Logout"), server.paths())
    }

    @Test
    fun an_empty_allowlist_signs_in_to_loopback() {
        answerEverything()
        val transport = transport("")
        val signedIn = passwordSignIn(transport, server.origin)
        val session = signedIn["session"] as? String
        assertNotNull(session, "the sign-in to http://127.0.0.1:<port> returned a session, not ${signedIn["error"]}")
        assertEquals(emptyMap<String, Any?>(), transport.endSession(mapOf("session" to session, "timeoutMs" to 5_000.0)))
        assertEquals(listOf("POST /Users/AuthenticateByName", "POST /Sessions/Logout"), server.paths())
    }

    // --- Where the rule is asked ---

    @Test
    fun only_session_transport_opens_a_session_and_it_asks_the_rule_before_it_sends() {
        val opening = TestSupport.mainSources(TestSupport.sessionMain).filter { it.readText().contains("SessionRegistry.open(") }
        assertEquals(listOf("SessionTransport.kt"), opening.map { it.name }, "the files of src/main that open a session")
        val text = opening.single().readText()
        val signIn = text.indexOf("fun signIn(")
        assertTrue(signIn >= 0, "SessionTransport.kt declares signIn")
        val check = text.indexOf("servers.check(", signIn)
        val send = Regex("""\bsend\(""").find(text, signIn)?.range?.first ?: -1
        assertTrue(send > signIn, "signIn sends")
        assertTrue(check in (signIn + 1) until send, "servers.check( stands in signIn before its first send(")
    }

    companion object {
        // Loopback and 10.0.2.2, in their written forms: "an empty allowlist admits only loopback and 10.0.2.2".
        val ADMITTED_WITHOUT_A_LIST = listOf(
            "http://localhost:8096",
            "http://127.0.0.1:8096",
            "http://127.9.9.9",
            "http://[::1]:8096",
            "http://[::ffff:127.0.0.1]",
            "http://10.0.2.2:8096",
            "https://10.0.2.2",
            "http://[::ffff:10.0.2.2]",
        )

        val REFUSED_WITHOUT_A_LIST = listOf(
            "http://10.0.2.3",
            "http://10.0.2.20",
            "http://10.0.3.2",
            "http://10.1.2.3",
            "http://media.home.arpa",
            "http://tv.local",
            "https://media.example",
            "https://10.0.2.2.example",
            "https://localhost.example",
            "https://203.0.113.7",
            "http://[fd00::1]",
            "http://[::ffff:10.0.2.3]",
        )
    }
}
