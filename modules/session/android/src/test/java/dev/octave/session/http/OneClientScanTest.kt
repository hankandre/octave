package dev.octave.session.http

import dev.octave.session.http.TestSupport.mainSources
import dev.octave.session.http.TestSupport.repoFile
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T3-03 review fix: a stricter source scan for item 1 than the frozen OneClientTest's, over the same files (Octave's
// own Kotlin and Java). Only OctaveHttp.kt may name OkHttpClient or read OctaveHttp.client; only DirectSocketFactory.kt
// may make a socket; nothing opens a java.net.URL, a URLConnection, another HTTP stack or Media3's default data
// sources; and newBuilder() is called only on a request or a response. It is still text, not types; T3-04's
// type-aware check replaces it (tasks/backlog.jsonl).
class OneClientScanTest {
    @Test
    fun the_scan_catches_each_way_round_the_frozen_scan() {
        val escapes = mapOf(
            "URL(u).openStream()" to "val s = java.net.URL(u).openStream()",
            "URL(u).readText()" to "val t = URL(u).readText()",
            "URI.toURL" to "val t = URI.create(u).toURL().readText()",
            "a raw Socket" to "val s = Socket(host, port)",
            "an imported Builder" to "import okhttp3.OkHttpClient.Builder\nval c = Builder().build()",
            "an aliased import in the client file" to "import okhttp3.OkHttpClient as Http",
            "a spaced builder" to "val c = OkHttpClient.Builder ().build()",
            "an aliased client" to "import okhttp3.OkHttpClient as Http\nval c = Http()",
            "a client read elsewhere" to "val c = OctaveHttp.client\nval d = c.newBuilder().build()",
            "a socket channel" to "val ch = SocketChannel.open()",
            "java.net.http" to "val c = java.net.http.HttpClient.newHttpClient()",
            "a URLConnection" to "val c: URLConnection = x",
            "a default data source" to "val f = DefaultHttpDataSource.Factory()",
        )
        for ((name, text) in escapes) {
            assertTrue(violations(mapOf("modules/x/android/src/main/java/X.kt" to text)).isNotEmpty(), "the scan catches $name")
        }
        // Inside the client file too, only `import okhttp3.OkHttpClient` itself is allowed.
        for (text in listOf("import okhttp3.OkHttpClient.Builder", "import okhttp3.OkHttpClient as Http", "val d = client.newBuilder().build()")) {
            assertTrue(violations(mapOf("modules/x/android/src/main/java/$CLIENT_FILE" to text)).isNotEmpty(), "the scan catches $text in $CLIENT_FILE")
        }
        val allowed = mapOf(
            "modules/x/android/src/main/java/A.kt" to "val r = request.newBuilder().build()\nval s = response.newBuilder().build()",
            "modules/x/android/src/main/java/B.kt" to "// java.net.URLEncoder differs on space\n/* OkHttpClient.Builder() */ val x = 1",
            "modules/x/android/src/main/java/C.kt" to "val u = \"http://example.invalid/\" // URL(",
        )
        assertEquals(emptyList<String>(), violations(allowed))
    }

    @Test
    fun octave_source_passes_the_strict_scan() {
        val modules = repoFile("modules").listFiles().orEmpty().map { File(it, "android/src/main") }
        val files = modules.flatMap { mainSources(it) } + mainSources(repoFile("apps/tv/native"))
        assertTrue(files.any { it.name == CLIENT_FILE }, "the scan reads $CLIENT_FILE")
        val texts = files.associate { it.invariantSeparatorsPath to it.readText() }
        assertEquals(emptyList<String>(), violations(texts))
        val builders = texts.filterKeys { it.endsWith("/$CLIENT_FILE") }.values.sumOf { BUILDER.findAll(code(it)).count() }
        assertEquals(1, builders, "OkHttpClient.Builder( in $CLIENT_FILE")
    }

    private fun violations(texts: Map<String, String>): List<String> {
        val found = mutableListOf<String>()
        for ((path, raw) in texts) {
            val text = code(raw)
            val file = path.substringAfterLast('/')
            for ((name, pattern) in FORBIDDEN) {
                if (pattern.containsMatchIn(text)) found += "$path: $name"
            }
            if (file != CLIENT_FILE) {
                if (Regex("""\bOkHttpClient\b""").containsMatchIn(text)) found += "$path: OkHttpClient outside $CLIENT_FILE"
                if (Regex("""\.\s*client\b""").containsMatchIn(text)) found += "$path: .client outside $CLIENT_FILE"
            }
            if (file != SOCKET_FILE && Regex("""\b(Socket|SSLSocket)\s*\(""").containsMatchIn(text)) found += "$path: a socket outside $SOCKET_FILE"
            for (match in Regex("""(\w+)\s*(\(\s*\))?\s*\??\s*\.\s*newBuilder\s*\(""").findAll(text)) {
                if (match.groupValues[1] !in setOf("request", "response")) found += "$path: ${match.groupValues[1]}.newBuilder("
            }
        }
        return found
    }

    private companion object {
        const val CLIENT_FILE = "OctaveHttp.kt"
        const val SOCKET_FILE = "DirectSocketFactory.kt"
        val BUILDER = Regex("""\bOkHttpClient\s*\.\s*Builder\s*\(""")
        val FORBIDDEN = mapOf(
            "an import of OkHttpClient's members or an alias" to Regex("""\bimport\s+okhttp3\.OkHttpClient\s*(\.|\bas\b)"""),
            "java.net.URL" to Regex("""\bURL\s*\(|\.\s*toURL\s*\(|\bopenStream\s*\(|\bopenConnection\s*\("""),
            "URLConnection" to Regex("""URLConnection\b"""),
            "a socket channel" to Regex("""\b(SocketChannel|DatagramSocket|AsynchronousSocketChannel)\b"""),
            "another HTTP stack" to Regex("""\bjava\.net\.http\b|\bHttpClient\b|\bOkHttpClientProvider\b|\bCronet\w*|\bVolley\b|\bDownloadManager\b"""),
            "Media3's default data sources" to Regex("""\bDefaultHttpDataSource\b|\bDefaultDataSource\b"""),
        )

        // The text with block comments and line comments removed. A `//` right after a ':' is a URL, not a comment.
        fun code(text: String): String =
            text.replace(Regex("""/\*[\s\S]*?\*/"""), " ").lines().joinToString("\n") { line ->
                val at = Regex("""(?<!:)//""").find(line)?.range?.first
                if (at == null) line else line.substring(0, at)
            }
    }
}
