package dev.octave.session.http

import dev.octave.session.http.StoreTestSupport.plaintext
import dev.octave.session.http.StoreTestSupport.plantRecord
import dev.octave.session.http.StoreTestSupport.recordName
import dev.octave.session.http.TransportTestSupport.json
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T4-05 item 8 (docs/specs/T4-05.md, D4): in a development build (DevelopmentServers.forBuild(true, ...)) a restore asks
// the development-server rule (T3-33) for each record's address before it opens a session. A record for a host that does
// not qualify opens no session, sends nothing and stays on disk; a qualifying one opens. A corrupt record is deleted in a
// development build too, since its address cannot be read. The scan pins SessionTransport.kt as the one opener of a
// session and requires every function that opens one to ask the rule first.
//
// Every address is loopback, the emulator host, or a private or documentation address that names no real server.
class RestoreDevelopmentBuildTest {
    private val rig = StoreRig("octave-t405-devbuild")

    @AfterEach
    fun close() = rig.close()

    private val dev = DevelopmentServers.forBuild(true, "")
    private val serverId = "0123456789abcdef0123456789abcd08"

    private fun plant(server: String, userId: String, token: String) =
        plantRecord(rig.root, rig.cipher.inner, recordName(serverId, userId), plaintext(server, token, userId, serverId, "Fixture Viewer"))

    @Test
    fun a_record_for_a_host_that_does_not_qualify_opens_nothing_sends_nothing_and_stays() {
        for ((index, server) in listOf("http://192.168.50.10:8096", "https://media.example", "http://media.home.arpa:8096").withIndex()) {
            val userId = "user-devbuild-refused-$index"
            val record = plant(server, userId, "t405-fake-token-refused-$index")
            val bytes = record.readBytes()
            val held = SessionRegistry.count()
            val sent = rig.server.requests.size

            val restored = rig.restoredFor(rig.transport(dev), userId)

            assertEquals(emptyList<Map<String, Any?>>(), restored, "$server: no session is listed")
            assertEquals(held, SessionRegistry.count(), "$server: no session is opened")
            assertEquals(sent, rig.server.requests.size, "$server: nothing is sent")
            assertTrue(record.isFile, "$server: the record stays on disk")
            assertArrayEquals(bytes, record.readBytes(), "$server: the record is unchanged")
        }
    }

    @Test
    fun a_refused_record_opens_in_a_release_build_over_the_same_store() {
        val record = plant("http://192.168.50.10:8096", "user-devbuild-later", "t405-fake-token-later")
        assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(dev), "user-devbuild-later"))

        assertEquals(1, rig.restoredFor(rig.transport(StoreTestSupport.release), "user-devbuild-later").size, "the kept record is the account's")
        assertTrue(record.isFile)
    }

    @Test
    fun a_record_for_a_qualifying_host_opens_and_its_requests_carry_the_token() {
        val token = "t405-fake-token-qualifying-3e4f"
        plant(rig.server.origin, "user-devbuild-loopback", token)
        plant("http://10.0.2.2:8096", "user-devbuild-emulator", "t405-fake-token-emulator")

        val transport = rig.transport(dev)
        val restored = rig.restore(transport)

        val loopback = restored.single { it["userId"] == "user-devbuild-loopback" }
        assertEquals(1, restored.count { it["userId"] == "user-devbuild-emulator" }, "the emulator host qualifies")
        rig.server.answer("/Users/Me") { json(200, "{}") }
        val answer = transport.request(mapOf("session" to loopback["session"], "method" to "GET", "path" to "/Users/Me", "timeoutMs" to 5_000.0))
        assertEquals(200, answer["status"])
        assertTrue(rig.server.requests.last().headers["Authorization"]?.contains("Token=\"$token\"") == true, "the request carried the stored token")
    }

    @Test
    fun a_corrupt_record_is_deleted_in_a_development_build_too() {
        val record = plant("http://192.168.50.10:8096", "user-devbuild-corrupt", "t405-fake-token-corrupt")
        val bytes = record.readBytes()
        bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 0x01).toByte()
        record.writeBytes(bytes)

        assertEquals(emptyList<Map<String, Any?>>(), rig.restoredFor(rig.transport(dev), "user-devbuild-corrupt"))

        assertFalse(record.exists(), "a corrupt record is deleted before the rule can be asked")
    }

    // --- The scan: the one opener of a session, and the rule before it ---

    @Test
    fun every_session_open_is_in_session_transport_in_a_function_that_asks_the_rule_first() {
        val opening = TestSupport.mainSources(TestSupport.sessionMain).filter { code(it).contains("SessionRegistry.open(") }
        assertEquals(listOf("SessionTransport.kt"), opening.map { it.name }, "the files of src/main that open a session")
        val text = code(opening.single())
        val functions = Regex("""\bfun\s+(?:<[^>]*>\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(""").findAll(text).map { it.range.first to it.groupValues[1] }.toList()
        val opens = Regex("""SessionRegistry\.open\(""").findAll(text).map { it.range.first }.toList()
        val openers = opens.map { at ->
            val (start, name) = functions.lastOrNull { it.first < at } ?: (-1 to "<none>")
            val check = if (start < 0) -1 else text.indexOf("servers.check(", start)
            assertTrue(check in (start + 1) until at, "SessionRegistry.open( in $name stands after servers.check( in the same function")
            name
        }
        assertTrue(openers.contains("signIn"), "signIn opens a session: $openers")
        assertTrue(openers.any { it != "signIn" }, "the restore path opens its sessions here too: $openers")
    }

    // Kotlin code without its comments.
    private fun code(file: java.io.File): String = file.readLines().joinToString("\n") { it.substringBefore("//") }
}
