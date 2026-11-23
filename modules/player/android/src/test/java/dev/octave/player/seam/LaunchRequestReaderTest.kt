package dev.octave.player.seam

import dev.octave.session.http.SessionId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T8-01 acceptance item 2 (docs/specs/T8-01.md, "The launch request"): LaunchRequestReader.read takes exactly the
// typed request union and refuses any other shape with null. It reads the argument map by hand against the key table:
// a missing required key, a key outside the table for the request's kind (at the top level or in a track), a wrong
// type, a number that is NaN or infinite, a negative start, an index that is not integral, more than 256 tracks, or
// a URL that fails U1 to U3 is refused. Numbers arrive as Double or Int. Every launch request the core builds
// (packages/core/tests/fixtures/launch-requests.json, spec check issue 2) is accepted.
//
// A non-URL string over 512 characters may be refused or cut to 512 (spec check issue 2 leaves the choice to the
// implementer); it never reaches the engine longer than 512.
class LaunchRequestReaderTest {
    private fun read(args: Map<String, Any?>): LaunchRequest? = LaunchRequestReader.read(args)

    private fun refused(args: Map<String, Any?>, why: String) = assertNull(read(args), "refuses $why")

    private fun accepted(args: Map<String, Any?>, why: String): LaunchRequest {
        val request = read(args)
        assertNotNull(request, "accepts $why")
        return request!!
    }

    private fun original(change: MutableMap<String, Any?>.() -> Unit): Map<String, Any?> = Samples.original().apply(change)

    private fun hls(change: MutableMap<String, Any?>.() -> Unit): Map<String, Any?> = Samples.hls().apply(change)

    private fun withTrack(base: MutableMap<String, Any?>, change: MutableMap<String, Any?>.() -> Unit): Map<String, Any?> =
        base.apply { this["tracks"] = listOf(Samples.audioTrack(), Samples.subtitleTrack().apply(change)) }

    private fun withUrl(url: String): Map<String, Any?> = original { this["url"] = url }

    private fun withSubtitleUrl(url: String): Map<String, Any?> = withTrack(Samples.original()) { this["deliveryUrl"] = url }

    @Test
    fun an_original_file_request_with_every_optional_key_is_read_field_by_field() {
        val request = accepted(Samples.original(), "an original-file request")
        assertTrue(request is LaunchRequest.Original, "an original-file request")
        val original = request as LaunchRequest.Original
        assertEquals(SessionId.parse(Samples.SESSION), original.session)
        assertEquals(Samples.ORIGINAL_URL, original.url)
        assertEquals(12.5, original.startPositionSeconds)
        assertEquals(1, original.audioStreamIndex)
        assertEquals(3, original.subtitleStreamIndex)
        assertEquals(2, original.tracks.size)
        val audio = original.tracks[0]
        assertEquals(1, audio.index)
        assertEquals("Audio", audio.type)
        assertEquals("English - AAC - Stereo", audio.displayTitle)
        assertFalse(audio.external)
        assertNull(audio.codec)
        assertNull(audio.language)
        assertNull(audio.deliveryUrl)
        assertNull(audio.title)
        assertNull(audio.channels)
        assertNull(audio.isDefault)
        assertNull(audio.isForced)
        assertNull(audio.isHearingImpaired)
        val subtitle = original.tracks[1]
        assertEquals(3, subtitle.index)
        assertEquals("Subtitle", subtitle.type)
        assertEquals("English - SRT", subtitle.displayTitle)
        assertTrue(subtitle.external)
        assertEquals("srt", subtitle.codec)
        assertEquals("eng", subtitle.language)
        assertEquals(Samples.SUBTITLE_URL, subtitle.deliveryUrl)
        assertEquals("Full", subtitle.title)
        assertEquals(2, subtitle.channels)
        assertEquals(false, subtitle.isDefault)
        assertEquals(false, subtitle.isForced)
        assertEquals(true, subtitle.isHearingImpaired)
    }

    @Test
    fun an_original_file_request_with_no_optional_key_is_read() {
        val request = accepted(Samples.minimalOriginal(), "a minimal original-file request") as LaunchRequest.Original
        assertNull(request.audioStreamIndex)
        assertNull(request.subtitleStreamIndex)
        assertEquals(0.0, request.startPositionSeconds)
        assertTrue(request.tracks.isEmpty())
    }

    @Test
    fun an_hls_request_with_and_without_optional_keys_is_read() {
        val request = accepted(Samples.hls(), "an HLS request")
        assertTrue(request is LaunchRequest.Hls, "an HLS request")
        val hls = request as LaunchRequest.Hls
        assertEquals(Samples.MASTER_URL, hls.masterUrl)
        assertEquals(Samples.SERVER_URL, hls.serverUrl)
        assertEquals(MediaKind.VIDEOS, hls.mediaKind)
        assertEquals(SessionId.parse(Samples.SESSION), hls.session)
        assertEquals(60.0, hls.startPositionSeconds)
        assertEquals(1, hls.audioStreamIndex)
        assertEquals(-1, hls.subtitleStreamIndex, "-1 is subtitles off")
        assertEquals(2, hls.tracks.size)
        val minimal = accepted(Samples.minimalHls(), "a minimal HLS request") as LaunchRequest.Hls
        assertEquals(MediaKind.AUDIO, minimal.mediaKind)
        assertNull(minimal.audioStreamIndex)
        assertNull(minimal.subtitleStreamIndex)
    }

    @Test
    fun numbers_arrive_as_double_or_int() {
        val request = accepted(
            original {
                this["startPositionSeconds"] = 0
                this["audioStreamIndex"] = 1
                this["subtitleStreamIndex"] = -1
                this["tracks"] = listOf(Samples.audioTrack().apply { this["index"] = 1; this["channels"] = 6 })
            },
            "Int numbers",
        ) as LaunchRequest.Original
        assertEquals(0.0, request.startPositionSeconds)
        assertEquals(1, request.audioStreamIndex)
        assertEquals(-1, request.subtitleStreamIndex)
        assertEquals(1, request.tracks.single().index)
        assertEquals(6, request.tracks.single().channels)
    }

    @Test
    fun every_launch_request_the_core_builds_is_accepted() {
        val fixture = TestJson.parse(File(Samples.repoRoot, "packages/core/tests/fixtures/launch-requests.json").readText()) as Map<*, *>
        val vectors = fixture["vectors"] as List<*>
        assertTrue(vectors.size >= 4, "the shared vectors are there")
        for (vector in vectors) {
            vector as Map<*, *>
            @Suppress("UNCHECKED_CAST")
            val args = vector["request"] as Map<String, Any?>
            val request = accepted(args, "the core's ${vector["name"]}")
            assertEquals(SessionId.parse(args["sessionId"] as String), request.session)
            assertEquals(args["startPositionSeconds"] as Double, request.startPositionSeconds)
            assertEquals((args["tracks"] as List<*>).size, request.tracks.size)
            when (args["kind"]) {
                "original" -> assertEquals(args["url"], (request as LaunchRequest.Original).url)
                "hls" -> {
                    request as LaunchRequest.Hls
                    assertEquals(args["masterUrl"], request.masterUrl)
                    assertEquals(args["serverUrl"], request.serverUrl)
                    assertEquals(args["mediaKind"], request.mediaKind.wire)
                }
                else -> error("a vector of an unknown kind")
            }
        }
    }

    @Test
    fun a_missing_required_key_is_refused() {
        for (key in listOf("kind", "url", "sessionId", "startPositionSeconds", "tracks")) refused(original { remove(key) }, "an original-file request without $key")
        for (key in listOf("kind", "masterUrl", "serverUrl", "mediaKind", "sessionId", "startPositionSeconds", "tracks")) refused(hls { remove(key) }, "an HLS request without $key")
        for (key in listOf("index", "type", "displayTitle", "external")) refused(withTrack(Samples.original()) { remove(key) }, "a track without $key")
    }

    @Test
    fun a_header_token_or_option_key_is_refused_at_the_top_level_and_in_a_track() {
        val keys = listOf("headers", "header", "authorization", "Authorization", "token", "accessToken", "apiKey", "options", "httpHeaders", "extra")
        for (key in keys) {
            refused(original { this[key] = "MediaBrowser Token=\"x\"" }, "$key on an original-file request")
            refused(hls { this[key] = mapOf("Authorization" to "x") }, "$key on an HLS request")
            refused(withTrack(Samples.original()) { this[key] = "x" }, "$key in a track")
            refused(withTrack(Samples.hls()) { this[key] = "x" }, "$key in an HLS request's track")
        }
    }

    @Test
    fun a_key_of_the_other_kind_is_refused() {
        refused(hls { this["url"] = Samples.ORIGINAL_URL }, "url on an HLS request")
        refused(original { this["masterUrl"] = Samples.MASTER_URL }, "masterUrl on an original-file request")
        refused(original { this["serverUrl"] = Samples.SERVER_URL }, "serverUrl on an original-file request")
        refused(original { this["mediaKind"] = "videos" }, "mediaKind on an original-file request")
    }

    @Test
    fun a_wrong_type_is_refused() {
        refused(original { this["kind"] = "file" }, "an unknown kind")
        refused(original { this["kind"] = "Original" }, "a kind in another case")
        refused(original { this["kind"] = null }, "a null kind")
        refused(original { this["kind"] = 1.0 }, "a number kind")
        refused(original { this["sessionId"] = Samples.SESSION.uppercase() }, "an upper-case session id")
        refused(original { this["sessionId"] = Samples.SESSION.drop(1) }, "a 31-digit session id")
        refused(original { this["sessionId"] = "session-1" }, "a session id that is not hex")
        refused(original { this["sessionId"] = 1.0 }, "a number session id")
        refused(original { this["startPositionSeconds"] = "12.5" }, "a string start")
        refused(original { this["startPositionSeconds"] = null }, "a null start")
        refused(original { this["tracks"] = "none" }, "tracks that are not a list")
        refused(original { this["tracks"] = mapOf("0" to Samples.audioTrack()) }, "tracks as a map")
        refused(original { this["tracks"] = listOf("audio") }, "a track that is not a map")
        refused(original { this["audioStreamIndex"] = 1.5 }, "a fractional audio index")
        refused(original { this["audioStreamIndex"] = "1" }, "a string audio index")
        refused(original { this["subtitleStreamIndex"] = true }, "a boolean subtitle index")
        refused(original { this["subtitleStreamIndex"] = 2.5 }, "a fractional subtitle index")
        refused(original { this["url"] = 1.0 }, "a number url")
        refused(hls { this["mediaKind"] = "video" }, "an unknown media kind")
        refused(hls { this["mediaKind"] = "Videos" }, "a media kind in another case")
        refused(withTrack(Samples.original()) { this["index"] = 1.5 }, "a fractional track index")
        refused(withTrack(Samples.original()) { this["index"] = "3" }, "a string track index")
        refused(withTrack(Samples.original()) { this["type"] = "Data" }, "an unknown track type")
        refused(withTrack(Samples.original()) { this["type"] = "subtitle" }, "a track type in another case")
        refused(withTrack(Samples.original()) { this["displayTitle"] = 1.0 }, "a number display title")
        refused(withTrack(Samples.original()) { this["external"] = "true" }, "a string external flag")
        refused(withTrack(Samples.original()) { this["codec"] = 1.0 }, "a number codec")
        refused(withTrack(Samples.original()) { this["language"] = false }, "a boolean language")
        refused(withTrack(Samples.original()) { this["title"] = listOf("x") }, "a list title")
        refused(withTrack(Samples.original()) { this["channels"] = 2.5 }, "fractional channels")
        refused(withTrack(Samples.original()) { this["isDefault"] = "yes" }, "a string default flag")
        refused(withTrack(Samples.original()) { this["isForced"] = 1.0 }, "a number forced flag")
        refused(withTrack(Samples.original()) { this["isHearingImpaired"] = "no" }, "a string hearing-impaired flag")
        refused(withTrack(Samples.original()) { this["deliveryUrl"] = 1.0 }, "a number delivery URL")
    }

    @Test
    fun a_number_that_is_not_finite_or_a_negative_start_is_refused() {
        for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -1.0, -0.5)) {
            refused(original { this["startPositionSeconds"] = value }, "a start of $value")
            refused(hls { this["startPositionSeconds"] = value }, "an HLS start of $value")
        }
        for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY)) {
            refused(original { this["audioStreamIndex"] = value }, "an audio index of $value")
            refused(withTrack(Samples.original()) { this["index"] = value }, "a track index of $value")
        }
    }

    @Test
    fun at_most_256_tracks_are_read() {
        val tracks = (0 until 256).map { Samples.audioTrack().apply { this["index"] = it.toDouble() } }
        assertEquals(256, accepted(original { this["tracks"] = tracks }, "256 tracks").tracks.size)
        refused(original { this["tracks"] = tracks + Samples.audioTrack() }, "257 tracks")
    }

    @Test
    fun a_string_over_512_characters_never_reaches_the_engine() {
        val limit = "t".repeat(512)
        assertEquals(limit, accepted(withTrack(Samples.original()) { this["displayTitle"] = limit }, "a 512-character title").tracks[1].displayTitle)
        for (key in listOf("displayTitle", "codec", "language", "title")) {
            val request = read(withTrack(Samples.original()) { this[key] = "t".repeat(513) })
            if (request != null) {
                val track = request.tracks[1]
                val value = when (key) {
                    "displayTitle" -> track.displayTitle
                    "codec" -> track.codec
                    "language" -> track.language
                    else -> track.title
                }
                assertTrue((value ?: "").length <= 512, "a 513-character $key is refused or cut to 512")
            }
        }
    }

    @Test
    fun u1_a_url_that_is_not_absolute_http_with_a_host_and_no_user_info_or_fragment_is_refused() {
        val bad = listOf(
            "ftp://media.test/Videos/a1b2c3d4/stream?Static=true",
            "file:///Videos/a1b2c3d4/stream?Static=true",
            "/Videos/a1b2c3d4/stream?Static=true",
            "media.test/Videos/a1b2c3d4/stream?Static=true",
            "https:///Videos/a1b2c3d4/stream?Static=true",
            "https://user:secret@media.test/Videos/a1b2c3d4/stream?Static=true",
            "https://user@media.test/Videos/a1b2c3d4/stream?Static=true",
            "https://media.test/Videos/a1b2c3d4/stream?Static=true#t=10",
            "https://media.test/Videos/a1b2c3d4/stream?Static=true#",
            "https://media.test/Videos/a b/stream?Static=true",
            "",
        )
        for (url in bad) refused(withUrl(url), "the url \"$url\"")
        for (url in listOf("ftp://media.test/a.vtt", "/Videos/a1b2c3d4/Stream.vtt", "https://user:secret@media.test/a.vtt", "https://media.test/a.vtt#x")) {
            refused(withSubtitleUrl(url), "the subtitle url \"$url\"")
        }
        refused(hls { this["masterUrl"] = "https://media.test/jellyfin/videos/a1b2c3d4/master.m3u8#x" }, "a master URL with a fragment")
        refused(hls { this["serverUrl"] = "https://user:secret@media.test/jellyfin" }, "a server URL with user info")
        refused(hls { this["serverUrl"] = "jellyfin" }, "a relative server URL")
    }

    @Test
    fun u1_a_url_over_8192_characters_is_refused() {
        val base = "${Samples.ORIGINAL_URL}&pad="
        val exact = base + "a".repeat(8192 - base.length)
        assertEquals(8192, exact.length)
        accepted(withUrl(exact), "an 8192-character url")
        refused(withUrl(exact + "a"), "an 8193-character url")
        refused(withSubtitleUrl(Samples.SUBTITLE_URL + "?pad=" + "a".repeat(8192)), "an over-long subtitle url")
    }

    @Test
    fun u2_every_url_of_one_request_has_one_origin() {
        refused(withSubtitleUrl("https://other.test/Videos/a1b2c3d4/a1b2c3d4/Subtitles/3/0/Stream.vtt"), "a subtitle on another host")
        refused(withSubtitleUrl("https://media.test:8443/Videos/a1b2c3d4/a1b2c3d4/Subtitles/3/0/Stream.vtt"), "a subtitle on another port")
        refused(withSubtitleUrl("http://media.test/Videos/a1b2c3d4/a1b2c3d4/Subtitles/3/0/Stream.vtt"), "a subtitle on another scheme")
        refused(hls { this["masterUrl"] = "https://other.test/jellyfin/videos/a1b2c3d4/master.m3u8?MediaSourceId=a1b2c3d4" }, "a master on another host than the server")
        refused(hls { this["serverUrl"] = "https://media.test:8920/jellyfin" }, "a server on another port than the master")
        refused(hls { this["serverUrl"] = "http://media.test/jellyfin" }, "a server on another scheme than the master")
        refused(withTrack(Samples.hls()) { this["deliveryUrl"] = "https://other.test/jellyfin/Videos/a/a/Subtitles/3/0/Stream.vtt" }, "an HLS subtitle on another host")
        accepted(withSubtitleUrl("https://MEDIA.test/Videos/a1b2c3d4/a1b2c3d4/Subtitles/3/0/Stream.vtt"), "a host compared in lower case")
        accepted(withSubtitleUrl("https://media.test:443/Videos/a1b2c3d4/a1b2c3d4/Subtitles/3/0/Stream.vtt"), "the effective port")
        accepted(
            original {
                this["url"] = "http://media.test:80/Videos/a1b2c3d4/stream?Static=true"
                this["tracks"] = listOf(Samples.subtitleTrack("http://media.test/Videos/a1b2c3d4/a1b2c3d4/Subtitles/3/0/Stream.vtt"))
            },
            "port 80 as the effective port of http",
        )
    }

    @Test
    fun u3_an_original_url_has_the_s1_path_and_one_static_true() {
        accepted(withUrl("https://media.test/jellyfin/Videos/a1b2c3d4/stream?Static=true"), "a base path")
        accepted(withUrl("https://media.test/a/b/Videos/a1b2c3d4/stream?MediaSourceId=x&static=true"), "a deeper base path and a lower-case name")
        accepted(withUrl("https://media.test/Videos/a1b2c3d4/stream?St%61tic=true"), "the Static name read decoded")
        refused(withUrl("https://media.test/Videos/a1b2c3d4/stream?Static=false"), "Static=false")
        refused(withUrl("https://media.test/Videos/a1b2c3d4/stream?Static=TRUE"), "Static=TRUE")
        refused(withUrl("https://media.test/Videos/a1b2c3d4/stream?MediaSourceId=a1b2c3d4"), "no Static")
        refused(withUrl("https://media.test/Videos/a1b2c3d4/stream"), "no query")
        refused(withUrl("https://media.test/Videos/a1b2c3d4/stream?Static=true&static=true"), "two Static")
        refused(withUrl("https://media.test/Videos/a1b2c3d4/stream?Static=true&St%61tic=true"), "two Static, one escaped")
        refused(withUrl("https://media.test/Videos/a1b2c3d4/master.m3u8?Static=true"), "a master path")
        refused(withUrl("https://media.test/Items/a1b2c3d4/stream?Static=true"), "an Items path")
        refused(withUrl("https://media.test/Videos/a1b2c3d4/stream/extra?Static=true"), "a segment after stream")
        refused(withUrl("https://media.test/Videos/a1b2c3d4/stream.mkv?Static=true"), "a stream with an extension")
        refused(withUrl("https://media.test/videos/a1b2c3d4/stream?Static=true"), "a lower-case Videos")
        refused(withUrl("https://media.test/Videos//stream?Static=true"), "an empty item segment")
        refused(withUrl("https://media.test/?Static=true"), "the root path")
    }
}
