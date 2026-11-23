package dev.octave.player.seam

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T8-01 (docs/specs/T8-01.md, "PlayerSeam behaviour"): every command with and without an engine, the order of the
// launch checks, an engine's failures as codes, and events only after initialize.
// - initialize: with an engine, toMap(engine.capabilities()) and the engine's listener set to emit(toMap(event));
//   with none, or when the engine throws, { probe: "failed" }.
// - launch: read the map (refused: unsupported-request); sessions.holds (false: session-ended); no engine:
//   unsupported-request; engine.launch.
// - setPaused { paused }, seek { positionSeconds } (finite, 0 or more), selectTrack { type, playerId? }: a bad map,
//   a key outside the map's table, or no engine is unsupported-request.
// - stop: with no engine {}.
// - Every call catches Throwable: a PlayerEngineException gives its code, anything else unknown.
class PlayerSeamTest {
    private val ok = emptyMap<String, Any?>()
    private val unsupported = mapOf("error" to "unsupported-request")

    private fun seamOf(engine: PlaybackEngine?, emitted: MutableList<Map<String, Any?>> = mutableListOf(), held: Boolean = true) =
        PlayerSeam(engine, SessionCheck { held }, { emitted += it })

    @Test
    fun initialize_without_an_engine_or_with_a_failing_one_is_cannot_tell() {
        assertEquals(mapOf("probe" to "failed"), seamOf(null).initialize())
        val engine = FakeEngine().apply { failure = RuntimeException("probe failed at https://media.test/x") }
        assertEquals(mapOf("probe" to "failed"), seamOf(engine).initialize())
        val throwing = FakeEngine().apply { failure = PlayerEngineException(PlayerErrorCode.NETWORK) }
        assertEquals(mapOf("probe" to "failed"), seamOf(throwing).initialize())
    }

    @Test
    fun initialize_with_an_engine_answers_its_capability_map() {
        val capabilities = Capabilities.Complete(
            listOf(VideoDecoder(codec = "h264", hardware = true, profile = null, maxBitDepth = null, maxWidth = null, maxHeight = null)),
            listOf("aac"),
            listOf(),
            listOf(),
        )
        val engine = FakeEngine(capabilities)
        assertEquals(PlayerEventMaps.toMap(capabilities), seamOf(engine).initialize())
    }

    @Test
    fun events_are_emitted_only_after_initialize_and_as_maps() {
        val engine = FakeEngine()
        val emitted = mutableListOf<Map<String, Any?>>()
        val seam = seamOf(engine, emitted)
        assertNull(engine.listener, "no listener before initialize")
        engine.emit(PlayerEvent.FirstFrame)
        assertTrue(emitted.isEmpty())
        seam.initialize()
        for (event in Samples.everyKind()) engine.emit(event)
        assertEquals(Samples.everyKind().map { PlayerEventMaps.toMap(it) }, emitted)
    }

    @Test
    fun launch_checks_the_map_then_the_session_then_the_engine() {
        val asked = mutableListOf<String>()
        val engine = FakeEngine()
        val held = PlayerSeam(engine, SessionCheck { asked += "holds"; true }, {})
        assertEquals(unsupported, held.launch(Samples.original().apply { this["token"] = "x" }))
        assertTrue(asked.isEmpty(), "a refused map is not asked about")
        assertEquals(ok, held.launch(Samples.original()))
        assertEquals(listOf("holds"), asked)
        assertEquals(listOf("launch"), engine.calls)
        assertEquals(ok, held.launch(Samples.hls()))
        assertTrue(engine.launched[1] is LaunchRequest.Hls)
        assertEquals(mapOf("error" to "session-ended"), seamOf(null, held = false).launch(Samples.original()))
        assertEquals(unsupported, seamOf(null, held = true).launch(Samples.original()))
    }

    @Test
    fun set_paused_reads_one_boolean() {
        val engine = FakeEngine()
        val seam = seamOf(engine)
        assertEquals(ok, seam.setPaused(mapOf("paused" to true)))
        assertEquals(ok, seam.setPaused(mapOf("paused" to false)))
        assertEquals(listOf("setPaused:true", "setPaused:false"), engine.calls)
        for (args in listOf<Map<String, Any?>>(mapOf(), mapOf("paused" to "true"), mapOf("paused" to 1.0), mapOf("paused" to null), mapOf("paused" to true, "options" to "x"))) {
            assertEquals(unsupported, seam.setPaused(args), "setPaused($args)")
        }
        assertEquals(2, engine.calls.size, "no bad map reached the engine")
        assertEquals(unsupported, seamOf(null).setPaused(mapOf("paused" to true)))
    }

    @Test
    fun seek_reads_one_finite_position_of_zero_or_more() {
        val engine = FakeEngine()
        val seam = seamOf(engine)
        assertEquals(ok, seam.seek(mapOf("positionSeconds" to 12.5)))
        assertEquals(ok, seam.seek(mapOf("positionSeconds" to 30)))
        assertEquals(ok, seam.seek(mapOf("positionSeconds" to 0.0)))
        assertEquals(listOf("seek:12.5", "seek:30.0", "seek:0.0"), engine.calls)
        for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -1.0, "10", null)) {
            assertEquals(unsupported, seam.seek(mapOf("positionSeconds" to value)), "seek($value)")
        }
        assertEquals(unsupported, seam.seek(mapOf()))
        assertEquals(unsupported, seam.seek(mapOf("positionSeconds" to 1.0, "url" to "https://media.test/x")))
        assertEquals(3, engine.calls.size, "no bad map reached the engine")
        assertEquals(unsupported, seamOf(null).seek(mapOf("positionSeconds" to 1.0)))
    }

    @Test
    fun select_track_reads_a_type_and_an_optional_player_id() {
        val engine = FakeEngine()
        val seam = seamOf(engine)
        assertEquals(ok, seam.selectTrack(mapOf("type" to "audio", "playerId" to 2.0)))
        assertEquals(ok, seam.selectTrack(mapOf("type" to "subtitle", "playerId" to 4)))
        assertEquals(ok, seam.selectTrack(mapOf("type" to "subtitle")))
        assertEquals(listOf("selectTrack:audio:2", "selectTrack:subtitle:4", "selectTrack:subtitle:null"), engine.calls)
        val bad = listOf<Map<String, Any?>>(
            mapOf(),
            mapOf("type" to "video", "playerId" to 1.0),
            mapOf("type" to "Audio", "playerId" to 1.0),
            mapOf("type" to "audio", "playerId" to 1.5),
            mapOf("type" to "audio", "playerId" to "1"),
            mapOf("type" to "audio", "playerId" to Double.NaN),
            mapOf("type" to 1.0),
            mapOf("type" to "audio", "playerId" to 1.0, "headers" to "x"),
        )
        for (args in bad) assertEquals(unsupported, seam.selectTrack(args), "selectTrack($args)")
        assertEquals(3, engine.calls.size, "no bad map reached the engine")
        assertEquals(unsupported, seamOf(null).selectTrack(mapOf("type" to "audio", "playerId" to 1.0)))
    }

    @Test
    fun stop_always_completes_without_an_engine() {
        assertEquals(ok, seamOf(null).stop())
        val engine = FakeEngine()
        assertEquals(ok, seamOf(engine).stop())
        assertEquals(listOf("stop"), engine.calls)
    }

    @Test
    fun an_engine_failure_is_its_code_and_anything_else_is_unknown() {
        for (code in enumValues<PlayerErrorCode>()) {
            val engine = FakeEngine().apply { failure = PlayerEngineException(code) }
            val seam = seamOf(engine)
            val expected = mapOf("error" to code.wire)
            assertEquals(expected, seam.launch(Samples.original()), "launch with $code")
            assertEquals(expected, seam.setPaused(mapOf("paused" to true)), "setPaused with $code")
            assertEquals(expected, seam.seek(mapOf("positionSeconds" to 1.0)), "seek with $code")
            assertEquals(expected, seam.selectTrack(mapOf("type" to "audio", "playerId" to 1.0)), "selectTrack with $code")
            assertEquals(expected, seam.stop(), "stop with $code")
        }
        val failures = listOf<Throwable>(
            RuntimeException("Source error at https://media.test/x"),
            IllegalStateException(),
            OutOfMemoryError(),
            StackOverflowError(),
            Exception("checked", RuntimeException("cause")),
        )
        for (thrown in failures) {
            val engine = FakeEngine().apply { failure = thrown }
            val seam = seamOf(engine)
            val unknown = mapOf("error" to "unknown")
            assertEquals(unknown, seam.launch(Samples.original()), "launch with ${thrown.javaClass.simpleName}")
            assertEquals(unknown, seam.setPaused(mapOf("paused" to false)))
            assertEquals(unknown, seam.seek(mapOf("positionSeconds" to 0.0)))
            assertEquals(unknown, seam.selectTrack(mapOf("type" to "subtitle")))
            assertEquals(unknown, seam.stop())
        }
    }

    @Test
    fun a_player_engine_exception_carries_its_code_and_no_cause() {
        val error = PlayerEngineException(Samples.code("decoder-failed"))
        assertEquals(Samples.code("decoder-failed"), error.code)
        assertEquals("decoder-failed", error.message)
        assertNull(error.cause)
    }
}
