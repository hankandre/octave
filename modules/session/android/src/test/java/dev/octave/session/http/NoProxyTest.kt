package dev.octave.session.http

import dev.octave.session.http.TestSupport.emptyExemptions
import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.header
import dev.octave.session.http.TestSupport.proxyProperties
import dev.octave.session.http.TestSupport.withDefaultProxySelector
import dev.octave.session.http.TestSupport.withSession
import dev.octave.session.http.TestSupport.withSystemProperties
import okhttp3.Authenticator
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotSame
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.URI
import javax.net.SocketFactory

// T3-03 item 4: no proxy is used, whatever the system or environment says.
// The assertions on the client do not depend on which test touched the client first; the request half proves that
// neither an HTTP proxy from the selector nor a SOCKS proxy from the JVM is used for a loopback server. It does not
// prove Android's own proxy settings on a device (T3-05's wire capture).
class NoProxyTest {
    private val servers = TwoServers()

    @AfterEach
    fun closeServers() = servers.close()

    @Test
    fun the_client_is_built_with_no_proxy() {
        val client = OctaveHttp.client
        assertSame(Proxy.NO_PROXY, client.proxy, "client.proxy")
        assertEquals(listOf(Proxy.NO_PROXY), client.proxySelector.select(URI("http://203.0.113.7/")), "selector answer for http")
        assertEquals(listOf(Proxy.NO_PROXY), client.proxySelector.select(URI("https://203.0.113.7/")), "selector answer for https")
        assertNotSame(ProxySelector.getDefault(), client.proxySelector, "the client's selector is not the JVM default")
        assertSame(Authenticator.NONE, client.proxyAuthenticator, "proxy authenticator")
        assertNotSame(SocketFactory.getDefault(), client.socketFactory, "the client's socket factory is not the JVM default")
        client.socketFactory.createSocket().use { socket -> assertFalse(socket.isConnected, "a new socket is not connected") }
    }

    @Test
    fun jvm_proxy_properties_naming_another_server_are_ignored() {
        withSystemProperties(proxyProperties(servers.b)) {
            // The environment would proxy this request: the JDK's own selector names B for A's URL.
            val proxied = ProxySelector.getDefault().select(URI(servers.a.url("/Items")))
            assertEquals(Proxy.Type.HTTP, proxied.first().type(), "precondition: the JDK selector answers an HTTP proxy for A")
            assertEquals(servers.b.port, (proxied.first().address() as InetSocketAddress).port, "precondition: the proxy is B")
            val socks = ProxySelector.getDefault().select(URI("socket://127.0.0.1:${servers.a.port}"))
            assertEquals(Proxy.Type.SOCKS, socks.first().type(), "precondition: the JDK selector answers a SOCKS proxy for A")

            withSession(servers.a.origin) { _, factory ->
                assertEquals(200, fetch(factory, servers.a.url("/Items")))
            }
        }
        val recorded = servers.a.requests.single()
        assertEquals("/Items", recorded.target, "server A received an origin-form target, not a proxy's absolute URL")
        assertEquals(header(), recorded.headers["Authorization"])
        servers.assertBReceivedNothing()
    }

    @Test
    fun a_default_proxy_selector_naming_another_server_is_never_asked_about_the_server() {
        val selector = RecordingProxySelector(servers.b)
        withSystemProperties(emptyExemptions) {
            withDefaultProxySelector(selector) {
                withSession(servers.a.origin) { _, factory ->
                    assertEquals(200, fetch(factory, servers.a.url("/Items")))
                }
            }
        }
        val recorded = servers.a.requests.single()
        assertEquals("/Items", recorded.target, "server A received an origin-form target, not a proxy's absolute URL")
        val askedAboutA = selector.asked.filter { it.port == servers.a.port }
        assertTrue(askedAboutA.isEmpty(), "the default selector was asked about A: $askedAboutA")
        servers.assertBReceivedNothing()
    }
}
