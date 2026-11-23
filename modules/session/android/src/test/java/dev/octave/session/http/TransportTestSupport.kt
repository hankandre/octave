package dev.octave.session.http

import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import java.net.InetAddress
import java.util.concurrent.CopyOnWriteArrayList

// Helpers for the T3-05 SessionTransport tests. Like TestSupport (frozen, T3-03), servers listen on the literal
// 127.0.0.1 and every URL is written with that literal.
internal object TransportTestSupport {
    // A made-up token with characters that percent-encoding changes; no real token appears in these tests.
    const val TOKEN = "tok/3f9a+b7c=0d1e ü"
    const val DEVICE_ID = "test-device-0001"

    // The rule of a release build (T3-33): these tests are about the transport, not about development builds.
    val transport = SessionTransport(ClientIdentity.of("Octave Test TV", "0.0.0"), DevelopmentServers.forBuild(false, ""))

    // The JSON a Jellyfin sign-in answers with, carrying `token`.
    fun signInAnswer(token: String = TOKEN, name: String = "louise"): MockResponse =
        MockResponse.Builder()
            .code(200)
            .addHeader("Content-Type", "application/json")
            .body("""{"AccessToken":"${token.replace("\"", "\\\"")}","User":{"Id":"user-1","Name":"$name"},"ServerId":"server-1"}""")
            .build()

    fun json(code: Int, body: String): MockResponse =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    fun passwordSignIn(server: String, timeoutMs: Number = 5_000): Map<String, Any?> = transport.signIn(
        mapOf(
            "server" to server,
            "deviceId" to DEVICE_ID,
            "kind" to "password",
            "username" to "louise",
            "password" to "placeholder-pw",
            "timeoutMs" to timeoutMs,
        ),
    )

    fun sessionRequest(session: Any?, method: String, path: String, extra: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        transport.request(mapOf("session" to session, "method" to method, "path" to path, "timeoutMs" to 5_000.0) + extra)

    fun tokenlessRequest(server: String, method: String, path: String, extra: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        transport.request(mapOf("server" to server, "deviceId" to DEVICE_ID, "method" to method, "path" to path, "timeoutMs" to 5_000.0) + extra)

    // Signs in against `server`, which must answer the sign-in first, and returns the session id.
    fun signIn(server: PathServer, base: String = server.origin): String {
        server.answer(base.removePrefix(server.origin) + "/Users/AuthenticateByName") { signInAnswer() }
        val result = passwordSignIn(base)
        return checkNotNull(result["session"] as? String) { "the sign-in failed: ${result["error"]}" }
    }

    // Every form a crossing must not hold: as written, percent-encoded with either hex case, and query-encoded.
    fun assertNoToken(text: String?, token: String = TOKEN) {
        if (text == null) return
        for (form in TokenStrip.forms(token)) assertFalse(text.contains(form), "a value that crosses holds the token")
    }

    fun assertError(expected: String, result: Map<String, Any?>) {
        assertEquals(mapOf("error" to expected), result, "result")
    }
}

// A MockWebServer on 127.0.0.1 that answers by path (the request target without its query); a path with no handler
// gets 404. Records every request.
internal class PathServer : AutoCloseable {
    private val handlers = java.util.concurrent.ConcurrentHashMap<String, (RecordedRequest) -> MockResponse>()
    val requests = CopyOnWriteArrayList<RecordedRequest>()
    private val server = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests.add(request)
                val path = request.target.substringBefore('?')
                return handlers[path]?.invoke(request) ?: MockResponse(404)
            }
        }
    }

    init {
        server.start(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)), 0)
    }

    val port: Int get() = server.port
    val origin: String get() = "http://127.0.0.1:$port"

    fun answer(path: String, handler: (RecordedRequest) -> MockResponse) {
        handlers[path] = handler
    }

    fun paths(): List<String> = requests.map { "${it.method} ${it.target.substringBefore('?')}" }

    override fun close() = server.close()
}
