package dev.octave.session.http

import dev.octave.session.http.TestSupport.CANARY
import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.header
import dev.octave.session.http.TestSupport.refused
import dev.octave.session.http.TestSupport.repoFile
import dev.octave.session.http.TestSupport.withSession
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T3-03 item 5: a URL with user info or a credential query parameter is refused, and so is a URL that holds the
// session's token (decision 0005, no_url_carries_the_token). Every URL is on A's origin unless it says otherwise.
class CredentialUrlTest {
    private val servers = TwoServers()

    @AfterEach
    fun closeServers() = servers.close()

    @Test
    fun user_info_is_refused() {
        val port = servers.a.port
        withSession(servers.a.origin) { _, factory ->
            for (url in listOf("http://user@127.0.0.1:$port/Items", "http://user:pw@127.0.0.1:$port/Items")) {
                refused(HttpRefusal.CREDENTIAL_URL) { fetch(factory, url) }
            }
        }
        assertEquals(0, servers.a.requestCount, "server A's request count")
        servers.assertBReceivedNothing()
    }

    @Test
    fun each_core_credential_name_is_refused_in_any_case_and_spelling() {
        val names = coreCredentialNames()
        assertEquals(7, names.size, "credential names in credential-query.ts: $names")
        withSession(servers.a.origin) { _, factory ->
            for (name in names) {
                for (written in listOf(name, mixedCase(name), name.uppercase())) {
                    refused(HttpRefusal.CREDENTIAL_URL) { fetch(factory, servers.a.url("/Items?Fields=Path&$written=x")) }
                }
            }
            // A percent-encoded name and a name with a leading encoded space are the same name once decoded and trimmed.
            for (query in listOf("Api%4Bey=x", "%20ApiKey=x", "api_key%20=x")) {
                refused(HttpRefusal.CREDENTIAL_URL) { fetch(factory, servers.a.url("/Items?$query")) }
            }
        }
        assertEquals(0, servers.a.requestCount, "server A's request count")
        servers.assertBReceivedNothing()
    }

    @Test
    fun no_url_carries_the_token() {
        val onceEncoded = percentEncodeEveryByte(CANARY)
        val fourTimesEncoded = (1..3).fold(onceEncoded) { text, _ -> text.replace("%", "%25") }
        withSession(servers.a.origin) { _, factory ->
            for (path in listOf(
                "/Items/$CANARY/Images",
                "/Items?SearchTerm=$CANARY",
                "/Items/$onceEncoded",
                "/Items?SearchTerm=$onceEncoded",
                "/Items/$fourTimesEncoded",
                "/Items?SearchTerm=$fourTimesEncoded",
            )) {
                refused(HttpRefusal.CREDENTIAL_URL) { fetch(factory, servers.a.url(path)) }
            }
        }
        // The token as written in the header (percent-encoded by the builder) and as its decoded form.
        withSession(servers.a.origin, header("CANARY%2Bokhttp-7f3a")) { _, factory ->
            refused(HttpRefusal.CREDENTIAL_URL) { fetch(factory, servers.a.url("/Items/CANARY%2Bokhttp-7f3a")) }
            refused(HttpRefusal.CREDENTIAL_URL) { fetch(factory, servers.a.url("/Items/CANARY+okhttp-7f3a")) }
        }
        assertEquals(0, servers.a.requestCount, "server A's request count")
        servers.assertBReceivedNothing()
    }

    @Test
    fun device_id_and_play_session_id_are_not_credentials() {
        withSession(servers.a.origin) { _, factory ->
            assertEquals(200, fetch(factory, servers.a.url("/Videos/1/stream?deviceId=abc&playSessionId=def&Static=true")))
        }
        assertEquals(1, servers.a.requestCount, "server A's request count")
        assertEquals(header(), servers.a.requests.single().headers["Authorization"])
        servers.assertBReceivedNothing()
    }

    @Test
    fun user_info_is_checked_before_the_origin_and_the_origin_before_the_query() {
        val portB = servers.b.port
        withSession(servers.a.origin) { _, factory ->
            refused(HttpRefusal.CREDENTIAL_URL) { fetch(factory, "http://user:pw@127.0.0.1:$portB/") }
            refused(HttpRefusal.OTHER_ORIGIN) { fetch(factory, "http://127.0.0.1:$portB/Items?ApiKey=x") }
        }
        assertEquals(0, servers.a.requestCount, "server A's request count")
        servers.assertBReceivedNothing()
    }

    // The names are read out of the core, so the Kotlin rule cannot drift from it (spec check note 2: the surface
    // declares no Kotlin symbol for the set, so the set is checked by behaviour, name by name).
    private fun coreCredentialNames(): List<String> {
        val source = repoFile("packages/core/src/jellyfin/credential-query.ts").readText()
        val block = checkNotNull(Regex("""CREDENTIAL_QUERY_NAMES\s*=\s*new Set\(\[(.*?)]\)""", RegexOption.DOT_MATCHES_ALL).find(source)) {
            "CREDENTIAL_QUERY_NAMES in credential-query.ts"
        }.groupValues[1]
        return Regex(""""([^"]+)"""").findAll(block).map { it.groupValues[1] }.toList()
    }

    private fun mixedCase(name: String): String =
        name.mapIndexed { index, char -> if (index % 2 == 0) char.lowercaseChar() else char.uppercaseChar() }.joinToString("")

    private fun percentEncodeEveryByte(text: String): String =
        text.toByteArray(Charsets.UTF_8).joinToString("") { "%%%02X".format(it.toInt() and 0xff) }
}
