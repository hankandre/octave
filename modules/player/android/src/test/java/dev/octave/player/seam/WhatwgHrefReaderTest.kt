package dev.octave.player.seam

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

// T8-01 spec check issue 2: the core forwards a WHATWG href, which may keep characters after the authority that
// java.net.URI refuses (`|`, `^`, `{`, `}`, `[`, `]`, `` ` ``, `\`). The reader escapes them only to parse, so such a
// request is still read, and the engine gets the text exactly as the core sent it. A space, which an href never
// holds, is still refused, and a bracketed host is still parsed as a host.
class WhatwgHrefReaderTest {
    private fun original(url: String): Map<String, Any?> = Samples.minimalOriginal().apply { this["url"] = url }

    @Test
    fun characters_an_href_keeps_in_the_query_are_read_and_kept() {
        val url = "https://media.test/Videos/a1b2c3d4/stream?Static=true&Tag=a|b^c{d}[e]`f\\g"
        val request = LaunchRequestReader.read(original(url)) as LaunchRequest.Original
        assertEquals(url, request.url)
    }

    @Test
    fun characters_an_href_keeps_in_the_path_are_read() {
        val url = "https://media.test/base^1/Videos/a1b2c3d4/stream?Static=true"
        assertEquals(url, (LaunchRequestReader.read(original(url)) as LaunchRequest.Original).url)
    }

    @Test
    fun a_subtitle_url_with_such_characters_is_read() {
        val subtitle = "https://media.test/Videos/a1b2c3d4/a1b2c3d4/Subtitles/3/0/Stream.vtt?x=[1]"
        val args = Samples.minimalOriginal().apply { this["tracks"] = listOf(Samples.subtitleTrack(subtitle)) }
        assertEquals(subtitle, LaunchRequestReader.read(args)!!.tracks.single().deliveryUrl)
    }

    @Test
    fun a_bracketed_host_is_a_host_and_a_space_is_still_refused() {
        val ipv6 = "http://[fd00::1]:8096/Videos/a1b2c3d4/stream?Static=true"
        val args = Samples.minimalOriginal().apply { this["url"] = ipv6 }
        assertEquals(ipv6, (LaunchRequestReader.read(args) as LaunchRequest.Original).url)
        assertNull(LaunchRequestReader.read(original("https://media.test/Videos/a1b2c3d4/stream?Static=true&x=a b")))
    }

    @Test
    fun an_escaped_static_name_and_an_href_character_together_count_once() {
        assertNull(LaunchRequestReader.read(original("https://media.test/Videos/a1b2c3d4/stream?St%61tic=true&static=true&x=|")))
    }
}
