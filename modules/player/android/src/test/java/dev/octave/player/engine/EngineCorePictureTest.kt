package dev.octave.player.engine

import dev.octave.player.engine.EngineSamples.ALL_PLAYABLE
import dev.octave.player.engine.EngineSamples.original
import dev.octave.player.seam.PlayerEvent
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T8-04 item 8, approach D12 (docs/specs/T8-04.md): EngineCore hands a PictureState to its `picture` callback
// whenever it changes. Awake means a launch is current, has neither ended nor failed, and is playing; buffering
// counts as playing. Paused, stopped, ended and failed are not awake, so the system's own timeout applies.
class EngineCorePictureTest {
    private class PictureRig {
        val handles = mutableListOf<FakeHandle>()
        val events = mutableListOf<PlayerEvent>()
        val pictures = mutableListOf<PictureState>()
        val core = EngineCore(
            { request -> FakeHandle(request).also { handles += it } },
            { events += it },
            { pictures += it },
        )

        val handle: FakeHandle get() = handles.last()
        val awake: Boolean? get() = pictures.lastOrNull()?.awake
    }

    private fun facts(playWhenReady: Boolean, buffering: Boolean = false) = HandleFacts(
        positionMs = 5_000L,
        durationMs = 330_000L,
        playWhenReady = playWhenReady,
        buffering = buffering,
        droppedFrames = 0,
        width = 1280,
        height = 720,
    )

    private fun playing(): PictureRig = PictureRig().apply {
        core.launch(original())
        core.signal(ALL_PLAYABLE)
        core.signal(EngineSignal.Ready)
        core.signal(EngineSignal.FirstFrameRendered)
    }

    // The fake's facts follow the call, so the state reads the same whether the core tracks play-when-ready
    // itself or asks the handle.
    private fun pause(rig: PictureRig, paused: Boolean) {
        rig.handle.facts = facts(playWhenReady = !paused)
        rig.core.setPaused(paused)
    }

    @Test
    fun awake_is_unknown_before_any_launch() {
        val rig = PictureRig()
        assertEquals(emptyList<PictureState>(), rig.pictures)
    }

    @Test
    fun awake_from_the_launch() {
        val rig = PictureRig()
        rig.core.launch(original())
        assertEquals(true, rig.awake)
    }

    @Test
    fun awake_is_cleared_by_a_pause_and_set_again_by_the_resume() {
        val rig = playing()
        pause(rig, paused = true)
        assertEquals(false, rig.awake)
        pause(rig, paused = false)
        assertEquals(true, rig.awake)
    }

    @Test
    fun awake_while_buffering() {
        val rig = playing()
        rig.handle.facts = facts(playWhenReady = true, buffering = true)
        rig.core.signal(EngineSignal.Buffering)
        assertEquals(true, rig.awake)
    }

    @Test
    fun awake_is_cleared_by_stop() {
        val rig = playing()
        rig.core.stop()
        assertEquals(false, rig.awake)
    }

    @Test
    fun awake_is_cleared_by_the_end_of_the_file() {
        val rig = playing()
        rig.core.signal(EngineSignal.Ended)
        assertEquals(false, rig.awake)
    }

    @Test
    fun awake_is_cleared_by_a_player_failure() {
        val rig = playing()
        rig.core.signal(EngineSignal.Failed(4003, emptyList()))
        assertEquals(false, rig.awake)
    }

    @Test
    fun awake_is_cleared_by_a_launch_with_nothing_decodable() {
        val rig = PictureRig()
        rig.core.launch(original())
        rig.core.signal(EngineSignal.TracksKnown(videoPresent = true, videoSupported = false, audioPresent = true, audioSupported = true))
        assertEquals(false, rig.awake)
    }

    @Test
    fun awake_stays_cleared_when_a_failed_launch_is_resumed() {
        val rig = playing()
        rig.core.signal(EngineSignal.Failed(4003, emptyList()))
        pause(rig, paused = false)
        assertEquals(false, rig.awake)
    }

    @Test
    fun awake_again_for_a_new_launch_after_a_paused_one() {
        val rig = playing()
        pause(rig, paused = true)
        rig.core.launch(original(startPositionSeconds = 30.0))
        assertEquals(true, rig.awake)
    }

    @Test
    fun awake_is_published_only_when_it_changes() {
        val rig = playing()
        rig.handle.facts = facts(playWhenReady = true, buffering = true)
        rig.core.signal(EngineSignal.Buffering)
        rig.handle.facts = facts(playWhenReady = true)
        rig.core.signal(EngineSignal.Ready)
        rig.core.tick()
        pause(rig, paused = true)
        pause(rig, paused = true)
        rig.core.tick()
        assertEquals(listOf(true, false), rig.pictures.map { it.awake })
    }
}
