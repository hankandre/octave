package dev.octave.session.http

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.Call
import okhttp3.Request
import okhttp3.Response
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ServerSocketFactory

// Shared helpers for the frozen T3-03 tests. The servers listen on the literal 127.0.0.1 and every URL is written
// with that literal, never with MockWebServer's url() or hostName, which are name lookups.
internal object TestSupport {
    // A made-up token; no real token, server address or name appears in these tests.
    const val CANARY = "CANARY-okhttp-7f3a"

    val repoRoot: File
        get() = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set; run the tests through pnpm tv:native:test" })

    fun repoFile(path: String): File = File(repoRoot, path)

    fun fixture(name: String): JsonObject =
        Json.parseToJsonElement(repoFile("packages/core/tests/fixtures/$name").readText()).jsonObject

    // A header value in the builder's five-field shape (packages/core/src/jellyfin/authorization-header.ts).
    fun header(token: String = CANARY, device: String = "Octave%20Test"): String =
        "MediaBrowser Client=\"Octave\", Device=\"$device\", DeviceId=\"test-device-0001\", Version=\"0.0.0\", Token=\"$token\""

    fun authorization(value: String = header()): MediaBrowserAuthorization =
        checkNotNull(MediaBrowserAuthorization.parse(value)) { "a well-formed header value was not accepted" }

    fun refused(expected: HttpRefusal, block: () -> Unit): OctaveHttpException {
        val error = assertThrows(OctaveHttpException::class.java) { block() }
        assertEquals(expected, error.refusal, "refusal code")
        return error
    }

    fun get(factory: Call.Factory, url: String, configure: Request.Builder.() -> Unit = {}): Response =
        factory.newCall(Request.Builder().url(url).apply(configure).build()).execute()

    // Sends a GET and reads the whole answer, so the connection goes back to the pool.
    fun fetch(factory: Call.Factory, url: String, configure: Request.Builder.() -> Unit = {}): Int =
        get(factory, url, configure).use { response ->
            response.body.string()
            response.code
        }

    fun <T> withSession(baseUrl: String, value: String = header(), block: (SessionId, Call.Factory) -> T): T {
        val session = SessionRegistry.open(baseUrl, authorization(value))
        try {
            return block(session, OctaveHttp.callFactory(session))
        } finally {
            SessionRegistry.close(session)
        }
    }

    fun <T> withSystemProperties(values: Map<String, String>, block: () -> T): T {
        val saved = values.keys.associateWith { System.getProperty(it) }
        try {
            values.forEach { (key, value) -> System.setProperty(key, value) }
            return block()
        } finally {
            saved.forEach { (key, value) -> if (value == null) System.clearProperty(key) else System.setProperty(key, value) }
        }
    }

    fun <T> withDefaultProxySelector(selector: ProxySelector?, block: () -> T): T {
        val saved = ProxySelector.getDefault()
        try {
            ProxySelector.setDefault(selector)
            return block()
        } finally {
            ProxySelector.setDefault(saved)
        }
    }

    // NoProxyTest case (a): the JDK's own properties name `proxy` as the HTTP, HTTPS and SOCKS proxy, and the two
    // exemption lists are the empty string, which removes the JDK's built-in loopback exemption.
    fun proxyProperties(proxy: TestServer): Map<String, String> = mapOf(
        "http.proxyHost" to "127.0.0.1",
        "http.proxyPort" to proxy.port.toString(),
        "https.proxyHost" to "127.0.0.1",
        "https.proxyPort" to proxy.port.toString(),
        "socksProxyHost" to "127.0.0.1",
        "socksProxyPort" to proxy.port.toString(),
        "http.nonProxyHosts" to "",
        "socksNonProxyHosts" to "",
    )

    val emptyExemptions: Map<String, String> = mapOf("http.nonProxyHosts" to "", "socksNonProxyHosts" to "")

    // The .kt and .java files under a directory, test sources excluded.
    fun mainSources(root: File): List<File> =
        if (!root.isDirectory) {
            emptyList()
        } else {
            root.walkTopDown()
                .filter { it.isFile && (it.name.endsWith(".kt") || it.name.endsWith(".java")) }
                .filterNot { it.invariantSeparatorsPath.contains("/src/test/") }
                .toList()
        }

    val sessionMain: File get() = repoFile("modules/session/android/src/main")
    val sessionHttpMain: File get() = repoFile("modules/session/android/src/main/java/dev/octave/session/http")
}

// NoProxyTest case (b): answers an HTTP proxy at `proxy` for http and https URIs and a SOCKS proxy for socket URIs,
// and records every URI it is asked about.
internal class RecordingProxySelector(proxy: TestServer) : ProxySelector() {
    private val address = InetSocketAddress(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)), proxy.port)
    val asked = CopyOnWriteArrayList<URI>()

    override fun select(uri: URI): List<Proxy> {
        asked.add(uri)
        return when (uri.scheme?.lowercase()) {
            "http", "https" -> listOf(Proxy(Proxy.Type.HTTP, address))
            "socket" -> listOf(Proxy(Proxy.Type.SOCKS, address))
            else -> listOf(Proxy.NO_PROXY)
        }
    }

    override fun connectFailed(uri: URI, sa: SocketAddress, ioe: IOException) = Unit
}

// Counts the connections a server accepts, so "receives nothing" covers a proxy handshake or a stray connection,
// not only a complete HTTP request.
internal class CountingServerSocketFactory : ServerSocketFactory() {
    val accepted = AtomicInteger()

    override fun createServerSocket(): ServerSocket = object : ServerSocket() {
        override fun accept(): Socket {
            val socket = super.accept()
            accepted.incrementAndGet()
            return socket
        }
    }

    override fun createServerSocket(port: Int): ServerSocket = throw UnsupportedOperationException()
    override fun createServerSocket(port: Int, backlog: Int): ServerSocket = throw UnsupportedOperationException()
    override fun createServerSocket(port: Int, backlog: Int, ifAddress: InetAddress?): ServerSocket = throw UnsupportedOperationException()
}

// A MockWebServer on 127.0.0.1 that answers queued responses first, then `fallback`, so a stray request never hangs.
internal class TestServer(private val fallback: MockResponse) : AutoCloseable {
    private val sockets = CountingServerSocketFactory()
    private val queue = LinkedBlockingQueue<MockResponse>()
    val requests = CopyOnWriteArrayList<RecordedRequest>()
    private val server = MockWebServer().apply {
        serverSocketFactory = sockets
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests.add(request)
                return queue.poll() ?: fallback
            }
        }
    }

    fun start() = server.start(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)), 0)

    val port: Int get() = server.port
    val origin: String get() = "http://127.0.0.1:$port"
    fun url(path: String): String = origin + path
    fun enqueue(response: MockResponse) {
        queue.add(response)
    }

    val requestCount: Int get() = server.requestCount
    val connections: Int get() = sockets.accepted.get()

    override fun close() = server.close()
}

// Server A stands for the session's server and server B for any other origin.
internal class TwoServers : AutoCloseable {
    val a = TestServer(MockResponse(200, body = "from A"))
    val b = TestServer(MockResponse(200, body = "from B"))

    init {
        a.start()
        b.start()
    }

    fun assertBReceivedNothing() {
        assertEquals(0, b.requestCount, "server B's request count")
        assertEquals(0, b.connections, "connections server B accepted")
    }

    override fun close() {
        try {
            a.close()
        } finally {
            b.close()
        }
    }
}
