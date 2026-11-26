package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.json
import mockwebserver3.MockResponse
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.PrintStream
import java.net.URLEncoder
import java.util.Base64

// T4-05 item 6 (docs/specs/T4-05.md, D3, D4): the token leaves the registry only as ciphertext. After a sign-in, a
// restore and a sign-out with a canary token, no file under the test's data root, no restoreSessions result and nothing
// written to standard output or standard error holds it: raw, percent-encoded, hex or base64 (at every alignment, so a
// token inside base64 of a larger text is found too). On a device, the probe and transport-canary read the rest (verify).
//
// The testing contract is in StoreTestSupport.kt.
class StoredCredentialCanaryTest {
    private val rig = StoreRig("octave-t405-canary")

    @AfterEach
    fun close() = rig.close()

    // Letters and digits only, so every encoding of it is one fixed string. Made up; no real token.
    private val canary = "CANARYt405store5a6b7c8d9e0f1a2b3c4d"

    private fun forms(): List<String> {
        val bytes = canary.toByteArray(Charsets.UTF_8)
        val hex = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        val found = mutableListOf(canary, URLEncoder.encode(canary, "UTF-8"), hex, hex.uppercase())
        found += TokenStrip.forms(canary)
        for (encoder in listOf(Base64.getEncoder(), Base64.getUrlEncoder())) {
            for (shift in 0..2) {
                // The token's bytes after `shift` other bytes: the middle of the encoding is the same wherever it sits.
                val text = encoder.withoutPadding().encodeToString(ByteArray(shift) { 0x41 } + bytes)
                val start = if (shift == 0) 0 else 4
                found += text.substring(start, text.length - 4)
            }
        }
        return found.distinct()
    }

    private fun holders(label: String, text: String): List<String> = forms().filter { text.contains(it) }.map { "$label holds $it" }

    private fun filesHolding(): List<String> =
        rig.dataRoot.walkTopDown().filter { it.isFile }.flatMap { file ->
            holders(file.relativeTo(rig.dataRoot).path, String(file.readBytes(), Charsets.ISO_8859_1))
        }.toList()

    @Test
    fun stored_credential_is_ciphertext() {
        listOf("files", "shared_prefs", "cache").forEach { File(rig.dataRoot, it).mkdirs() }
        val captured = ByteArrayOutputStream()
        val savedOut = System.out
        val savedErr = System.err
        val problems = mutableListOf<String>()
        try {
            val print = PrintStream(captured, true, "UTF-8")
            System.setOut(print)
            System.setErr(print)

            val session = rig.signedIn(rig.transport(), canary, "user-canary-1", "0123456789abcdef0123456789abcd06")
            problems += filesHolding().map { "after sign-in: $it" }

            rig.relaunch()
            val result = rig.transport().restore()
            problems += holders("the restoreSessions result", result.toString())
            val restored = StoreTestSupport.sessionsOf(result).single { it["userId"] == "user-canary-1" }
            problems += filesHolding().map { "after restore: $it" }

            rig.server.answer("/Users/Me") { json(200, "{}") }
            rig.transport().request(mapOf("session" to restored["session"], "method" to "GET", "path" to "/Users/Me", "timeoutMs" to 5_000.0))
            rig.server.answer("/Sessions/Logout") { MockResponse(204) }
            rig.transport().endSession(mapOf("session" to restored["session"], "timeoutMs" to 5_000.0))
            rig.transport().endSession(mapOf("session" to session, "timeoutMs" to 5_000.0))
            problems += filesHolding().map { "after sign-out: $it" }
            problems += holders("the restoreSessions result after sign-out", rig.transport().restore().toString())
        } finally {
            System.setOut(savedOut)
            System.setErr(savedErr)
        }
        problems += holders("standard output and error", captured.toString("UTF-8"))
        assertEquals(emptyList<String>(), problems, "places the canary token reached")
    }
}
