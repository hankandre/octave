package dev.octave.player.seam

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T8-01 acceptance item 4 (docs/specs/T8-01.md, "The Kotlin seam"): PlayerEventMaps.toMap writes each of the port's
// six event kinds from its typed fields with the port's wire names and nothing else. An optional field that is null is
// left out, not written as null. A `reason` outside eof, stopped and error is written as error; a `cause` outside
// pause, seek and property is left out. Strings in a snapshot (decodeLabel, a track's title and language, codec
// names) are cut to 256 characters. An error event carries its code only. The capability maps are the port's
// PlayerCapabilities. Every value is a plain map, list, string, number or boolean.
class PlayerEventMapsTest {
    private val snapshotKeys = setOf(
        "positionSeconds", "durationSeconds", "paused", "buffering", "volume", "muted", "audioTrack", "subtitleTrack",
        "tracks", "diagnostics", "video", "audio", "bufferedSeconds",
    )
    private val bareSnapshotKeys = setOf("positionSeconds", "paused", "buffering", "volume", "muted", "tracks", "diagnostics")
    private val trackKeys = setOf("playerId", "jellyfinIndex", "type", "title", "language", "external", "selected")
    private val diagnosticsKeys = setOf("decodeMode", "decodeLabel", "videoCodec", "bitDepth", "width", "height", "droppedFrames")
    private val videoKeys = setOf("codec", "range", "dolbyVisionProfile")
    private val audioKeys = setOf("codec", "channelCount", "sampleRate", "outputChannelCount", "output", "passthroughFormat")

    private fun asMap(value: Any?): Map<*, *> {
        assertTrue(value is Map<*, *>, "a map: $value")
        return value as Map<*, *>
    }

    private fun list(value: Any?): List<*> {
        assertTrue(value is List<*>, "a list: $value")
        return value as List<*>
    }

    private fun number(value: Any?): Double {
        assertTrue(value is Number, "a number: $value")
        return (value as Number).toDouble()
    }

    // Every value, at any depth, is a plain map with string keys, a list, a string, a number or a boolean.
    private fun assertPlain(value: Any?, path: String = "map") {
        when (value) {
            is Map<*, *> -> for ((key, inner) in value) {
                assertTrue(key is String, "$path has a key that is not a string: $key")
                assertTrue(inner != null, "$path.$key is written as null")
                assertPlain(inner, "$path.$key")
            }
            is List<*> -> value.forEachIndexed { index, inner -> assertPlain(inner, "$path[$index]") }
            is String, is Boolean, is Int, is Long, is Double, is Float -> Unit
            else -> throw AssertionError("$path holds a ${value?.javaClass?.name}")
        }
    }

    private fun assertFullSnapshot(value: Any?) {
        val snapshot = asMap(value)
        assertEquals(snapshotKeys, snapshot.keys)
        assertEquals(61.5, number(snapshot["positionSeconds"]))
        assertEquals(5400.0, number(snapshot["durationSeconds"]))
        assertEquals(false, snapshot["paused"])
        assertEquals(true, snapshot["buffering"])
        assertEquals(100.0, number(snapshot["volume"]))
        assertEquals(false, snapshot["muted"])
        assertEquals(2.0, number(snapshot["audioTrack"]))
        assertEquals(5.0, number(snapshot["subtitleTrack"]))
        assertEquals(75.0, number(snapshot["bufferedSeconds"]))
        val track = asMap(list(snapshot["tracks"]).single())
        assertEquals(trackKeys, track.keys)
        assertEquals(2.0, number(track["playerId"]))
        assertEquals(1.0, number(track["jellyfinIndex"]))
        assertEquals("Audio", track["type"])
        assertEquals("English", track["title"])
        assertEquals("eng", track["language"])
        assertEquals(false, track["external"])
        assertEquals(true, track["selected"])
        val diagnostics = asMap(snapshot["diagnostics"])
        assertEquals(diagnosticsKeys, diagnostics.keys)
        assertEquals("hardware", diagnostics["decodeMode"])
        assertEquals("c2.example.hevc.decoder", diagnostics["decodeLabel"])
        assertEquals("hevc", diagnostics["videoCodec"])
        assertEquals(10.0, number(diagnostics["bitDepth"]))
        assertEquals(3840.0, number(diagnostics["width"]))
        assertEquals(2160.0, number(diagnostics["height"]))
        assertEquals(3.0, number(diagnostics["droppedFrames"]))
        val video = asMap(snapshot["video"])
        assertEquals(videoKeys, video.keys)
        assertEquals("hevc", video["codec"])
        assertEquals("pq", video["range"])
        assertEquals(8.0, number(video["dolbyVisionProfile"]))
        val audio = asMap(snapshot["audio"])
        assertEquals(audioKeys, audio.keys)
        assertEquals("eac3", audio["codec"])
        assertEquals(6.0, number(audio["channelCount"]))
        assertEquals(48000.0, number(audio["sampleRate"]))
        assertEquals(6.0, number(audio["outputChannelCount"]))
        assertEquals("passthrough", audio["output"])
        assertEquals("eac3", audio["passthroughFormat"])
    }

    @Test
    fun each_kind_has_exactly_the_ports_keys() {
        val loaded = PlayerEventMaps.toMap(PlayerEvent.Loaded(Samples.fullSnapshot()))
        assertEquals(setOf("kind", "snapshot"), loaded.keys)
        assertEquals("loaded", loaded["kind"])
        assertFullSnapshot(loaded["snapshot"])

        assertEquals(mapOf("kind" to "first-frame"), PlayerEventMaps.toMap(PlayerEvent.FirstFrame))

        val state = PlayerEventMaps.toMap(PlayerEvent.State(Samples.fullSnapshot(), "seek"))
        assertEquals(setOf("kind", "snapshot", "cause"), state.keys)
        assertEquals("state", state["kind"])
        assertEquals("seek", state["cause"])
        assertFullSnapshot(state["snapshot"])

        val tracks = PlayerEventMaps.toMap(PlayerEvent.TracksChanged(Samples.fullSnapshot()))
        assertEquals(setOf("kind", "snapshot"), tracks.keys)
        assertEquals("tracks-changed", tracks["kind"])
        assertFullSnapshot(tracks["snapshot"])

        val ended = PlayerEventMaps.toMap(PlayerEvent.Ended(reason = "stopped", snapshot = Samples.fullSnapshot()))
        assertEquals(setOf("kind", "reason", "snapshot"), ended.keys)
        assertEquals("ended", ended["kind"])
        assertEquals("stopped", ended["reason"])
        assertFullSnapshot(ended["snapshot"])

        for (code in enumValues<PlayerErrorCode>()) {
            assertEquals(mapOf("kind" to "error", "code" to code.wire), PlayerEventMaps.toMap(PlayerEvent.Error(code)))
        }
        for (event in Samples.everyKind()) assertPlain(PlayerEventMaps.toMap(event))
    }

    @Test
    fun the_kinds_and_codes_are_the_ports() {
        assertEquals(
            listOf("loaded", "first-frame", "state", "tracks-changed", "ended", "error"),
            Samples.everyKind().map { it.kind },
        )
        assertEquals(
            listOf(
                "network", "server-error", "session-ended", "unsafe-playlist", "unsupported-request", "malformed-media",
                "decoder-unavailable", "decoder-failed", "audio-output-failed", "stop-failed", "unknown",
            ),
            enumValues<PlayerErrorCode>().map { it.wire },
        )
        assertEquals("network", PlayerErrorCode.NETWORK.wire)
        assertEquals("unknown", PlayerErrorCode.UNKNOWN.wire)
    }

    @Test
    fun optional_fields_are_absent_when_null() {
        val loaded = PlayerEventMaps.toMap(PlayerEvent.Loaded(Samples.bareSnapshot()))
        val snapshot = asMap(loaded["snapshot"])
        assertEquals(bareSnapshotKeys, snapshot.keys)
        assertEquals(setOf("playerId", "type", "title", "external", "selected"), asMap(list(snapshot["tracks"]).single()).keys)
        assertEquals(setOf("decodeMode", "decodeLabel", "droppedFrames"), asMap(snapshot["diagnostics"]).keys)
        assertPlain(loaded)

        assertEquals(setOf("kind", "snapshot"), PlayerEventMaps.toMap(PlayerEvent.State(Samples.bareSnapshot())).keys)
        assertEquals(mapOf("kind" to "ended", "reason" to "eof"), PlayerEventMaps.toMap(PlayerEvent.Ended(reason = "eof")))
    }

    @Test
    fun a_reason_or_cause_outside_the_ports_values_is_error_or_left_out() {
        assertEquals(mapOf("kind" to "ended", "reason" to "error"), PlayerEventMaps.toMap(PlayerEvent.Ended(reason = "crashed at https://media.test/x")))
        assertEquals("error", PlayerEventMaps.toMap(PlayerEvent.Ended(reason = "EOF"))["reason"])
        for (reason in listOf("eof", "stopped", "error")) assertEquals(reason, PlayerEventMaps.toMap(PlayerEvent.Ended(reason = reason))["reason"])
        for (cause in listOf("pause", "seek", "property")) assertEquals(cause, PlayerEventMaps.toMap(PlayerEvent.State(Samples.bareSnapshot(), cause))["cause"])
        for (cause in listOf("resume", "Seek", "https://media.test/x", "")) {
            val state = PlayerEventMaps.toMap(PlayerEvent.State(Samples.bareSnapshot(), cause))
            assertEquals(setOf("kind", "snapshot"), state.keys, "the cause \"$cause\" is left out")
        }
    }

    @Test
    fun snapshot_strings_are_cut_to_256_characters() {
        val long = "x".repeat(300)
        val snapshot = asMap(PlayerEventMaps.toMap(PlayerEvent.Loaded(Samples.fullSnapshot(decodeLabel = long, trackTitle = long, codec = long)))["snapshot"])
        val cut = "x".repeat(256)
        assertEquals(cut, asMap(snapshot["diagnostics"])["decodeLabel"])
        assertEquals(cut, asMap(snapshot["diagnostics"])["videoCodec"])
        assertEquals(cut, asMap(list(snapshot["tracks"]).single())["title"])
        assertEquals(cut, asMap(snapshot["video"])["codec"])
        val other = PlaybackSnapshot(
            positionSeconds = 0.0,
            durationSeconds = null,
            paused = false,
            buffering = false,
            volume = 100.0,
            muted = false,
            audioTrack = null,
            subtitleTrack = null,
            tracks = listOf(Samples.playerTrack(title = "t", language = long)),
            diagnostics = Samples.diagnostics(),
            video = null,
            audio = AudioFacts(codec = long, channelCount = null, sampleRate = null, outputChannelCount = null, output = null, passthroughFormat = null),
            bufferedSeconds = null,
        )
        val otherMap = asMap(PlayerEventMaps.toMap(PlayerEvent.Loaded(other))["snapshot"])
        assertEquals(cut, asMap(list(otherMap["tracks"]).single())["language"])
        assertEquals(cut, asMap(otherMap["audio"])["codec"])
        val exact = "y".repeat(256)
        assertEquals(exact, asMap(asMap(asMap(PlayerEventMaps.toMap(PlayerEvent.Loaded(Samples.fullSnapshot(decodeLabel = exact))))["snapshot"])["diagnostics"])["decodeLabel"])
    }

    @Test
    fun the_capability_maps_are_the_ports() {
        assertEquals(mapOf("probe" to "failed"), PlayerEventMaps.toMap(Capabilities.Failed))
        val complete = PlayerEventMaps.toMap(
            Capabilities.Complete(
                listOf(
                    VideoDecoder(codec = "hevc", hardware = true, profile = "Main 10", maxBitDepth = 10, maxWidth = 3840, maxHeight = 2160),
                    VideoDecoder(codec = "h264", hardware = false, profile = null, maxBitDepth = null, maxWidth = null, maxHeight = null),
                ),
                listOf("aac", "eac3"),
                listOf("hdr10"),
                listOf("eac3", "truehd"),
            ),
        )
        assertEquals(setOf("probe", "videoDecoders", "audioDecoders", "hdr", "passthrough"), complete.keys)
        assertEquals("complete", complete["probe"])
        val decoders = list(complete["videoDecoders"]).map { asMap(it) }
        assertEquals(setOf("codec", "hardware", "profile", "maxBitDepth", "maxWidth", "maxHeight"), decoders[0].keys)
        assertEquals("hevc", decoders[0]["codec"])
        assertEquals(true, decoders[0]["hardware"])
        assertEquals("Main 10", decoders[0]["profile"])
        assertEquals(10.0, number(decoders[0]["maxBitDepth"]))
        assertEquals(3840.0, number(decoders[0]["maxWidth"]))
        assertEquals(2160.0, number(decoders[0]["maxHeight"]))
        assertEquals(mapOf("codec" to "h264", "hardware" to false), decoders[1])
        assertEquals(listOf("aac", "eac3"), complete["audioDecoders"])
        assertEquals(listOf("hdr10"), complete["hdr"])
        assertEquals(listOf("eac3", "truehd"), complete["passthrough"])
        assertPlain(complete)
        assertFalse(complete.containsKey("url"))
    }
}
