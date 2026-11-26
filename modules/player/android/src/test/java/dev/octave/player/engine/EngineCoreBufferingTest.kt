package dev.octave.player.engine

import dev.octave.player.engine.EngineSamples.ALL_PLAYABLE
import dev.octave.player.engine.EngineSamples.original
import dev.octave.player.seam.PlayerEvent
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T8-04 item 6, approach D11 (docs/specs/T8-04.md): once a launch is loaded, the engine says when buffering starts
// and ends. `Buffering` emits one `state` with cause `property`, and so does a later `Ready`; each snapshot carries
// the handle's facts. Before `loaded`, and once the launch ended, failed or stopped, neither emits.
class EngineCoreBufferingTest {
    private fun facts(positionMs: Long = 0L, buffering: Boolean) = HandleFacts(
        positionMs = positionMs,
        durationMs = 330_000L,
        playWhenReady = true,
        buffering = buffering,
        droppedFrames = 0,
        width = 1280,
        height = 720,
    )

    private fun loaded(): EngineRig = EngineRig().apply {
        core.launch(original())
        core.signal(ALL_PLAYABLE)
        core.signal(EngineSignal.Ready)
        core.signal(EngineSignal.FirstFrameRendered)
        events.clear()
    }

    private fun startBuffering(rig: EngineRig, positionMs: Long = 0L) {
        rig.handle.facts = facts(positionMs = positionMs, buffering = true)
        rig.core.signal(EngineSignal.Buffering)
    }

    private fun stopBuffering(rig: EngineRig, positionMs: Long = 0L) {
        rig.handle.facts = facts(positionMs = positionMs, buffering = false)
        rig.core.signal(EngineSignal.Ready)
    }

    @Test
    fun buffering_after_loaded_emits_one_property_state_that_says_buffering() {
        val rig = loaded()
        startBuffering(rig)
        assertEquals(listOf("state"), rig.kinds)
        val state = rig.events.single() as PlayerEvent.State
        assertEquals("property", state.cause)
        assertTrue(state.snapshot.buffering, "the snapshot says buffering")
    }

    @Test
    fun buffering_ends_with_one_property_state_that_says_not_buffering() {
        val rig = loaded()
        startBuffering(rig)
        rig.events.clear()
        stopBuffering(rig)
        assertEquals(listOf("state"), rig.kinds)
        val state = rig.events.single() as PlayerEvent.State
        assertEquals("property", state.cause)
        assertFalse(state.snapshot.buffering, "the snapshot says not buffering")
    }

    @Test
    fun buffering_state_carries_the_handle_position() {
        val rig = loaded()
        startBuffering(rig, positionMs = 42_000L)
        stopBuffering(rig, positionMs = 42_500L)
        val positions = rig.events.filterIsInstance<PlayerEvent.State>().map { it.snapshot.positionSeconds }
        assertEquals(listOf(42.0, 42.5), positions)
    }

    @Test
    fun buffering_twice_emits_one_start_and_one_end_each_time_and_loaded_once() {
        val rig = loaded()
        startBuffering(rig)
        stopBuffering(rig)
        startBuffering(rig)
        stopBuffering(rig)
        assertEquals(List(4) { "state" }, rig.kinds)
        val flags = rig.events.filterIsInstance<PlayerEvent.State>().map { it.snapshot.buffering }
        assertEquals(listOf(true, false, true, false), flags)
        assertEquals(0, rig.count("loaded"), "loaded is not sent again")
        assertEquals(0, rig.count("first-frame"), "first-frame is not sent again")
    }

    @Test
    fun buffering_before_loaded_emits_nothing_and_ready_sends_loaded_once() {
        val rig = EngineRig()
        rig.core.launch(original())
        rig.events.clear()
        startBuffering(rig)
        assertEquals(emptyList<String>(), rig.kinds)

        stopBuffering(rig)
        assertEquals(listOf("loaded"), rig.kinds)
    }

    @Test
    fun buffering_after_ended_emits_nothing() {
        val rig = loaded()
        rig.core.signal(EngineSignal.Ended)
        rig.events.clear()
        startBuffering(rig)
        stopBuffering(rig)
        assertEquals(emptyList<String>(), rig.kinds)
    }

    @Test
    fun buffering_after_a_failure_emits_nothing() {
        val rig = loaded()
        rig.core.signal(EngineSignal.Failed(4003, emptyList()))
        rig.events.clear()
        startBuffering(rig)
        stopBuffering(rig)
        assertEquals(emptyList<String>(), rig.kinds)
    }

    @Test
    fun buffering_after_stop_emits_nothing() {
        val rig = loaded()
        val stopped = rig.handle
        rig.core.stop()
        rig.events.clear()
        stopped.facts = facts(buffering = true)
        rig.core.signal(EngineSignal.Buffering)
        rig.core.signal(EngineSignal.Ready)
        assertEquals(emptyList<String>(), rig.kinds)
    }

    @Test
    fun buffering_after_a_new_launch_waits_for_that_launch_to_load() {
        val rig = loaded()
        rig.core.launch(original(startPositionSeconds = 30.0))
        rig.events.clear()
        startBuffering(rig)
        assertEquals(emptyList<String>(), rig.kinds)

        stopBuffering(rig)
        assertEquals(listOf("loaded"), rig.kinds)
        rig.events.clear()
        startBuffering(rig, positionMs = 31_000L)
        assertEquals(listOf("state"), rig.kinds)
    }

    @Test
    fun buffering_neither_plays_pauses_seeks_nor_releases() {
        val rig = loaded()
        val before = rig.handle.calls.toList()
        startBuffering(rig)
        stopBuffering(rig)
        assertEquals(before, rig.handle.calls)
    }
}
