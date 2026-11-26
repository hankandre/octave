package dev.octave.session.http

import dev.octave.session.http.TestSupport.fixture
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import java.net.URI

// T4-02 item 8: the native client refuses and accepts the same https addresses as the core, judged against the one
// fixed expectation in packages/core/tests/fixtures/https-hosts.json that the core's gateway-https-host.test.ts reads.
class HttpsHostAgreementTest {
    private data class Vector(val address: String, val serverUrl: String?)

    private val hosts = fixture("https-hosts.json")

    private fun list(name: String): List<Vector> =
        hosts[name]!!.jsonArray.map {
            val vector = it.jsonObject
            Vector(vector["address"]!!.jsonPrimitive.content, vector["serverUrl"]?.jsonPrimitive?.content)
        }

    private fun hostOf(url: String): String = checkNotNull(URI(url).host) { "no host in $url" }.lowercase()

    @TestFactory
    fun the_native_client_refuses_every_refused_vector(): List<DynamicTest> {
        val refused = list("refused")
        assertTrue(refused.size >= 8, "https-hosts.json holds ${refused.size} refused vectors, fewer than 8")
        return refused.map { vector ->
            DynamicTest.dynamicTest("T4-02 item 8: refused: ${vector.address}") {
                TestSupport.refused(HttpRefusal.INVALID_ADDRESS) { ServerAddress.parse(vector.address) }
            }
        }
    }

    @TestFactory
    fun the_native_client_accepts_every_accepted_vector_and_the_server_url_the_core_hands_over(): List<DynamicTest> {
        val accepted = list("accepted")
        assertTrue(accepted.size >= 3, "https-hosts.json holds ${accepted.size} accepted vectors, fewer than 3")
        return accepted.flatMap { vector ->
            val serverUrl = checkNotNull(vector.serverUrl) { "accepted vector ${vector.address} has no serverUrl" }
            val expectedHost = hostOf(serverUrl)
            listOf(vector.address, serverUrl).map { text ->
                DynamicTest.dynamicTest("T4-02 item 8: accepted: $text") {
                    val parsed = ServerAddress.parse(text)
                    assertEquals("https", parsed.scheme, text)
                    assertEquals(expectedHost, parsed.host, text)
                }
            }
        }
    }

    @TestFactory
    fun the_native_client_refuses_an_invalid_punycode_host_or_keeps_it_exactly_as_written(): List<DynamicTest> {
        val invalid = list("invalidPunycode")
        assertTrue(invalid.size >= 3, "https-hosts.json holds ${invalid.size} invalidPunycode vectors, fewer than 3")
        return invalid.flatMap { vector ->
            val serverUrl = checkNotNull(vector.serverUrl) { "invalidPunycode vector ${vector.address} has no serverUrl" }
            listOf(vector.address, serverUrl).map { text ->
                DynamicTest.dynamicTest("T4-02 item 8: invalidPunycode: $text") {
                    val parsed = parseOrRefusal(text)
                    if (parsed == null) return@dynamicTest
                    assertEquals(hostOf(text), parsed.host, text)
                }
            }
        }
    }

    // Returns null when the address is refused as INVALID_ADDRESS; any other refusal or exception fails the test.
    private fun parseOrRefusal(text: String): ServerAddress? {
        try {
            return ServerAddress.parse(text)
        } catch (error: OctaveHttpException) {
            if (error.refusal != HttpRefusal.INVALID_ADDRESS) fail<Unit>("$text was refused as ${error.refusal}, not INVALID_ADDRESS")
            return null
        }
    }
}
