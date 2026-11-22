package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.assertError
import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

// T3-16 item 1 (gate: met; docs/specs/T3-16.md, "Named pins"): the native request method accepts no header and no
// absolute URL. A header argument, a path that is not a server path and another origin are each refused before
// anything is sent. Server A holds the session; server B stands for any other origin. One invocation per shape.
class RequestSeamTest {
    private val a = PathServer()
    private val b = PathServer()

    @AfterEach
    fun close() {
        try {
            a.close()
        } finally {
            b.close()
        }
    }

    @ParameterizedTest(name = "{0}")
    @ValueSource(
        strings = [
            "header key headers",
            "header key header",
            "header key Authorization",
            "header key authorization",
            "absolute http URL as path",
            "absolute https URL as path",
            "protocol-relative path",
            "path without a leading slash",
            "empty path",
            "url key",
            "server key naming server B beside a session",
            "origin key",
            "host key",
            "baseUrl key",
            "tokenless request to server B outside the pre-sign-in routes",
        ],
    )
    fun request_refuses_headers_absolute_urls_and_other_origins(shape: String) {
        val session = signIn(a)
        a.requests.clear()
        val bAuthority = "127.0.0.1:${b.port}"
        val result = when (shape) {
            "header key headers" -> sessionRequest(session, "GET", "/Items", mapOf("headers" to mapOf("X-Test" to "1")))
            "header key header" -> sessionRequest(session, "GET", "/Items", mapOf("header" to listOf("X-Test", "1")))
            "header key Authorization" -> sessionRequest(session, "GET", "/Items", mapOf("Authorization" to "MediaBrowser Token=\"other\""))
            "header key authorization" -> sessionRequest(session, "GET", "/Items", mapOf("authorization" to "MediaBrowser Token=\"other\""))
            "absolute http URL as path" -> sessionRequest(session, "GET", "http://$bAuthority/Items")
            "absolute https URL as path" -> sessionRequest(session, "GET", "https://$bAuthority/Items")
            "protocol-relative path" -> sessionRequest(session, "GET", "//$bAuthority/Items")
            "path without a leading slash" -> sessionRequest(session, "GET", "Items")
            "empty path" -> sessionRequest(session, "GET", "")
            "url key" -> sessionRequest(session, "GET", "/Items", mapOf("url" to "${b.origin}/Items"))
            "server key naming server B beside a session" -> sessionRequest(session, "GET", "/Items", mapOf("server" to b.origin))
            "origin key" -> sessionRequest(session, "GET", "/Items", mapOf("origin" to b.origin))
            "host key" -> sessionRequest(session, "GET", "/Items", mapOf("host" to bAuthority))
            "baseUrl key" -> sessionRequest(session, "GET", "/Items", mapOf("baseUrl" to b.origin))
            "tokenless request to server B outside the pre-sign-in routes" -> tokenlessRequest(b.origin, "GET", "/Items")
            else -> error("unknown shape $shape")
        }
        try {
            assertError("refused", result)
            assertEquals(emptyList<String>(), a.paths(), "server A received nothing after the sign-in")
            assertEquals(emptyList<String>(), b.paths(), "server B received nothing")
        } finally {
            SessionRegistry.close(SessionId.parse(session)!!)
        }
    }
}
