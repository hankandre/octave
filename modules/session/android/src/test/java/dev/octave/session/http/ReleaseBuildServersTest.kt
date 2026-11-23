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
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test

// T3-33 item 3 (docs/specs/T3-33.md, "The rule", Test plan): a release build, an app that is not debuggable
// (DevelopmentServers.forBuild(false, ...)), holds no allowlist and signs in as before. Every address item 1's class
// names that ServerAddress.parse accepts is admitted whatever text is handed in, and through SessionTransport the
// sign-ins and the calls before sign-in to a home-network name reach the server. These are the positive controls of
// DevelopmentBuildRefusalTest's zero-request cases. No case reads BuildConfig or the environment.
class ReleaseBuildServersTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    // An empty list, a list that names none of the addresses, and a list of entries that admit nothing.
    private val texts = listOf("", "unrelated.home.arpa,192.0.2.1,[fd00::99]", "*,*.home.arpa,10.1.2.0/24,http://media.home.arpa,media.home.arpa:8096,media home.arpa")

    @Test
    fun every_address_that_server_address_accepts_is_admitted_whatever_the_list() {
        var parsed = 0
        for (url in ADDRESSES) {
            val address = try {
                ServerAddress.parse(url)
            } catch (_: OctaveHttpException) {
                continue
            }
            parsed += 1
            for (text in texts) {
                try {
                    DevelopmentServers.forBuild(false, text).check(address)
                } catch (error: OctaveHttpException) {
                    fail<Unit>("a release build refused $url with ${error.refusal.code} (list \"$text\")")
                }
            }
        }
        assertTrue(parsed >= 25, "the cases reached the rule ($parsed addresses parsed)")
    }

    private fun transport(): SessionTransport = SessionTransport(ClientIdentity.of("Octave Test TV", "0.0.0"), DevelopmentServers.forBuild(false, ""))

    private fun signIn(transport: SessionTransport, url: String, kind: String): Map<String, Any?> {
        val credentials = if (kind == "password") mapOf("username" to "louise", "password" to "placeholder-pw") else mapOf("secret" to "placeholder-secret")
        return transport.signIn(mapOf("server" to url, "deviceId" to DEVICE_ID, "kind" to kind, "timeoutMs" to 5_000.0) + credentials)
    }

    @Test
    fun a_release_build_signs_in_to_a_home_network_name_as_before() {
        server.answer("/Users/AuthenticateByName") { signInAnswer() }
        server.answer("/Users/AuthenticateWithQuickConnect") { signInAnswer() }
        server.answer("/Sessions/Logout") { MockResponse(204) }
        val transport = transport()
        val url = "http://media.home.arpa:${server.port}"
        withAnswers(table("media.home.arpa" to listOf(LOOPBACK))) { _ ->
            for ((kind, path) in listOf("password" to "POST /Users/AuthenticateByName", "quick-connect" to "POST /Users/AuthenticateWithQuickConnect")) {
                val before = server.requests.size
                val result = signIn(transport, url, kind)
                val session = result["session"] as? String
                assertNotNull(session, "$kind: the sign-in returned a session, not ${result["error"]}")
                assertEquals(listOf(path), server.paths().drop(before), "$kind: one request reached the server")
                transport.endSession(mapOf("session" to session, "timeoutMs" to 5_000.0))
            }
        }
    }

    @Test
    fun a_release_build_sends_every_call_before_sign_in_to_a_home_network_name() {
        for ((_, path) in RequestPolicy.PRE_SIGN_IN_ROUTES) server.answer(path) { json(200, "{}") }
        val transport = transport()
        val url = "http://media.home.arpa:${server.port}"
        withAnswers(table("media.home.arpa" to listOf(LOOPBACK))) { _ ->
            for ((method, path) in RequestPolicy.PRE_SIGN_IN_ROUTES) {
                val body = if (method == "POST") mapOf("body" to "{}") else emptyMap()
                val result = transport.request(mapOf("server" to url, "deviceId" to DEVICE_ID, "method" to method, "path" to path, "timeoutMs" to 5_000.0) + body)
                assertEquals(200, result["status"], "$method $path: ${result["error"]}")
            }
        }
        assertEquals(RequestPolicy.PRE_SIGN_IN_ROUTES.map { (method, path) -> "$method $path" }, server.paths(), "each call reached the server once")
    }

    companion object {
        // Every address of DevelopmentBuildRefusalTest's lists: admitted and refused there, the other IPv4 spellings,
        // the listed hosts and their neighbours, and the plain-HTTP public name ServerAddress.parse refuses.
        val ADDRESSES = DevelopmentBuildRefusalTest.ADMITTED_WITHOUT_A_LIST + DevelopmentBuildRefusalTest.REFUSED_WITHOUT_A_LIST + listOf(
            "http://0x0a000203",
            "http://10.0.515",
            "http://0x0a000202",
            "http://10.0.514",
            "http://media.home.arpa:8096",
            "http://MEDIA.Home.Arpa:8096",
            "https://media.home.arpa:8920",
            "http://10.1.2.3:8096",
            "http://[fd00::1]:8096",
            "http://[FD00::1]:8096",
            "http://sub.media.home.arpa",
            "http://media.home.arpa.example",
            "https://media.home.arpa.example",
            "http://10.1.2.4",
            "http://[fd00::2]",
            "http://media.example",
            "https://media.example:8920",
        )
    }
}
