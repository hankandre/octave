package dev.octave.player.seam

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T8-01 review: rule U1 takes scheme, host and port from the raw authority with the core's host grammar (R1, R2 of
// packages/core/src/domain/host-class.ts), so a host with `_`, which java.net.URI reads as having no host, is read.
// The vectors in packages/core/tests/fixtures/launch-requests-host-edges.json are what the core builds on the edges of
// that grammar (scripts/tv-launch-request-host-edges.test.ts); every one is accepted here.
class LaunchRequestHostEdgesTest {
    private fun withUrl(url: String): Map<String, Any?> = Samples.minimalOriginal().apply { this["url"] = url }

    private fun withSubtitle(url: String, subtitle: String): Map<String, Any?> =
        Samples.minimalOriginal().apply {
            this["url"] = url
            this["tracks"] = listOf(Samples.subtitleTrack(subtitle))
        }

    @Test
    fun every_host_edge_vector_the_core_builds_is_accepted() {
        val fixture = TestJson.parse(File(Samples.repoRoot, "packages/core/tests/fixtures/launch-requests-host-edges.json").readText()) as Map<*, *>
        val vectors = fixture["vectors"] as List<*>
        assertTrue(vectors.size >= 4, "the host edge vectors are there")
        for (vector in vectors) {
            vector as Map<*, *>
            @Suppress("UNCHECKED_CAST")
            val args = vector["request"] as Map<String, Any?>
            val request = LaunchRequestReader.read(args)
            assertNotNull(request, "accepts the core's ${vector["name"]}")
            when (request) {
                is LaunchRequest.Original -> assertEquals(args["url"], request.url)
                is LaunchRequest.Hls -> {
                    assertEquals(args["masterUrl"], request.masterUrl)
                    assertEquals(args["serverUrl"], request.serverUrl)
                }
                null -> Unit
            }
            assertEquals((args["tracks"] as List<*>).map { (it as Map<*, *>)["deliveryUrl"] }, request!!.tracks.map { it.deliveryUrl })
        }
    }

    @Test
    fun a_host_with_an_underscore_is_read_with_its_port() {
        val url = "http://media_box:8096/Videos/abc/stream?Static=true"
        assertEquals(url, (LaunchRequestReader.read(withUrl(url)) as LaunchRequest.Original).url)
        assertNotNull(LaunchRequestReader.read(withSubtitle(url, "http://MEDIA_BOX:8096/Videos/abc/abc/Subtitles/3/0/Stream.vtt")))
        assertNull(LaunchRequestReader.read(withSubtitle(url, "http://media_box:8097/Videos/abc/abc/Subtitles/3/0/Stream.vtt")), "another port")
        assertNull(LaunchRequestReader.read(withSubtitle(url, "http://media-box:8096/Videos/abc/abc/Subtitles/3/0/Stream.vtt")), "another host")
        assertNull(LaunchRequestReader.read(withSubtitle(url, "https://media_box:8096/Videos/abc/abc/Subtitles/3/0/Stream.vtt")), "another scheme")
    }

    @Test
    fun a_default_port_written_out_is_the_same_origin() {
        val url = "https://media.test/Videos/abc/stream?Static=true"
        assertNotNull(LaunchRequestReader.read(withSubtitle(url, "https://media.test:443/Videos/abc/abc/Subtitles/3/0/Stream.vtt")))
        assertNull(LaunchRequestReader.read(withSubtitle(url, "https://media.test:80/Videos/abc/abc/Subtitles/3/0/Stream.vtt")))
    }

    @Test
    fun a_host_or_port_outside_the_grammar_is_still_refused() {
        val refused = listOf(
            "http://user@media_box:8096/Videos/abc/stream?Static=true",
            "http://user:pass@media.test/Videos/abc/stream?Static=true",
            "http://media%5Fbox:8096/Videos/abc/stream?Static=true",
            "http://médiá.test/Videos/abc/stream?Static=true",
            "http://media box/Videos/abc/stream?Static=true",
            "http://media.test:65536/Videos/abc/stream?Static=true",
            "http://media.test:123456/Videos/abc/stream?Static=true",
            "http://[fd00::1/Videos/abc/stream?Static=true",
            "http://[zz::1]/Videos/abc/stream?Static=true",
            "http:///Videos/abc/stream?Static=true",
            "http://media.test\\Videos/abc/stream?Static=true",
            "ftp://media.test/Videos/abc/stream?Static=true",
            "http://media.test:8096@other.test/Videos/abc/stream?Static=true",
        )
        for (url in refused) assertNull(LaunchRequestReader.read(withUrl(url)), "refuses $url")
    }
}
