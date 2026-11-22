package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.DEVICE_ID
import dev.octave.session.http.TransportTestSupport.assertError
import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

// T3-05: the six tokenless calls of decision 0005 ("Before sign-in"). The four pre-sign-in routes go out with the
// tokenless header (Token=""), a seventh route is refused before anything is sent, and the header's Client, Device
// and Version come from ClientIdentity.
class PreSignInTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    private val expectedHeader = MediaBrowserHeader.buildTokenless("Octave", "Octave Test TV", DEVICE_ID, "0.0.0")

    @Test
    fun the_four_pre_sign_in_routes_send_the_tokenless_header() {
        for ((method, path) in RequestPolicy.PRE_SIGN_IN_ROUTES) server.answer(path) { json(200, "{}") }
        for ((method, path) in RequestPolicy.PRE_SIGN_IN_ROUTES) {
            val extra = if (method == "POST") mapOf("body" to "{}") else emptyMap()
            assertEquals(200, tokenlessRequest(server.origin, method, path, extra)["status"], "$method $path")
        }
        assertEquals(RequestPolicy.PRE_SIGN_IN_ROUTES.map { (method, path) -> "$method $path" }, server.paths())
        for (request in server.requests) assertEquals(expectedHeader, request.headers["Authorization"], request.target)
        assertEquals(
            "MediaBrowser Client=\"Octave\", Device=\"Octave%20Test%20TV\", DeviceId=\"test-device-0001\", Version=\"0.0.0\", Token=\"\"",
            expectedHeader,
        )
    }

    @Test
    fun a_seventh_route_without_a_session_is_refused_and_sends_nothing() {
        val routes = listOf(
            "GET" to "/Users/Me",
            "GET" to "/UserViews",
            "POST" to "/Sessions/Logout",
            "POST" to "/Users/AuthenticateByName",
            "POST" to "/System/Info/Public",
            "GET" to "/QuickConnect/Initiate",
            "GET" to "/System/Info/Public/",
            "GET" to "/system/info/public",
        )
        for ((method, path) in routes) {
            val extra = if (method == "POST") mapOf("body" to "{}") else emptyMap()
            assertError("refused", tokenlessRequest(server.origin, method, path, extra))
        }
        assertEquals(emptyList<String>(), server.paths(), "nothing was sent")
    }

    @Test
    fun the_tokenless_authority_allows_only_the_six_calls_under_the_base_path_and_the_origin() {
        val address = ServerAddress.parse("http://127.0.0.1:8096/jf")
        fun check(method: String, url: String): HttpRefusal? {
            val body = if (method == "POST") ByteArray(0).toRequestBody(null) else null
            return RequestPolicy.checkTokenless(address, Request.Builder().url(url).method(method, body).build())
        }
        for ((method, path) in RequestPolicy.TOKENLESS_CALLS) assertNull(check(method, "http://127.0.0.1:8096/jf$path"), "$method $path")
        assertEquals(6, RequestPolicy.TOKENLESS_CALLS.size)
        assertEquals(HttpRefusal.ROUTE_NOT_ALLOWED, check("GET", "http://127.0.0.1:8096/System/Info/Public"), "outside the base path")
        assertEquals(HttpRefusal.ROUTE_NOT_ALLOWED, check("GET", "http://127.0.0.1:8096/jf/Users/Me"))
        assertEquals(HttpRefusal.ROUTE_NOT_ALLOWED, check("DELETE", "http://127.0.0.1:8096/jf/System/Info/Public"))
        assertEquals(HttpRefusal.OTHER_ORIGIN, check("GET", "http://127.0.0.1:8097/jf/System/Info/Public"))
        assertEquals(HttpRefusal.CREDENTIAL_URL, check("GET", "http://127.0.0.1:8096/jf/System/Info/Public?api_key=x"))
        assertEquals(HttpRefusal.CREDENTIAL_URL, check("GET", "http://u:p@127.0.0.1:8096/jf/System/Info/Public"))
    }

    @Test
    fun a_public_plain_http_or_malformed_server_is_refused_before_sending() {
        for (bad in listOf("http://203.0.113.7:8096", "http://media.example", "ftp://127.0.0.1", "http://127.0.0.1:8096/?x=1", "not a url")) {
            assertError("refused", tokenlessRequest(bad, "GET", "/System/Info/Public"))
        }
    }

    @Test
    fun the_client_name_is_the_core_app_name() {
        val identity = TestSupport.repoFile("packages/core/src/domain/app-identity.ts").readText()
        val appName = Regex("""export const APP_NAME = "([^"]*)";""").find(identity)?.groupValues?.get(1)
        assertEquals(appName, ClientIdentity.CLIENT)
    }

    // The model name is a new input from outside Octave: it is encoded by the fixture's rules (authorization-header.json),
    // so a quote or a non-ASCII character cannot break the header.
    @Test
    fun a_model_name_with_a_quote_and_non_ascii_is_encoded_as_the_header_fixture_requires() {
        val identity = ClientIdentity.of("Salon \"TV\" é, 4K", "1.2.3")
        assertEquals("Salon \"TV\" é, 4K", identity.device)
        val header = MediaBrowserHeader.build(ClientIdentity.CLIENT, identity.device, DEVICE_ID, identity.version, "t")
        assertEquals(
            "MediaBrowser Client=\"Octave\", Device=\"Salon%20%22TV%22%20%C3%A9%2C%204K\", DeviceId=\"test-device-0001\", Version=\"1.2.3\", Token=\"t\"",
            header,
        )
        assertNotNull(MediaBrowserAuthorization.parse(header))
        assertEquals("Android TV", ClientIdentity.of("  ", null).device)
        assertEquals("Android TV", ClientIdentity.of(null, "").device)
        assertEquals("0.0.0", ClientIdentity.of(null, null).version)
        assertEquals("a�b", ClientIdentity.of("a\uD83Db", "1").device, "a lone surrogate is replaced, so the builder never throws")
    }
}
