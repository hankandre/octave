package dev.octave.player.engine

import dev.octave.player.engine.EngineSamples.ALL_PLAYABLE
import dev.octave.player.engine.EngineSamples.original
import dev.octave.player.seam.PlayerEvent
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T8-03 item 2, approach D4 (docs/specs/T8-03.md): the engine reports its position every second. EngineCore.tick()
// emits one `state` event with cause `property`, carrying the handle's position, while a launch is current and
// loaded and has neither ended nor failed; otherwise it emits nothing. Media3Engine calls it once a second.
class EngineCoreTickTest {
    private fun facts(positionMs: Long, playWhenReady: Boolean = true) = HandleFacts(
        positionMs = positionMs,
        durationMs = 330_000L,
        playWhenReady = playWhenReady,
        buffering = false,
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

    private fun propertyStates(rig: EngineRig): List<PlayerEvent.State> =
        rig.events.filterIsInstance<PlayerEvent.State>().filter { it.cause == "property" }

    @Test
    fun tick_with_no_launch_emits_nothing() {
        val rig = EngineRig()
        rig.core.tick()
        assertEquals(emptyList<String>(), rig.kinds)
    }

    @Test
    fun tick_before_loaded_emits_nothing() {
        val rig = EngineRig()
        rig.core.launch(original())
        rig.core.signal(EngineSignal.Buffering)
        rig.events.clear()
        rig.core.tick()
        assertEquals(emptyList<String>(), rig.kinds)
    }

    @Test
    fun tick_while_loaded_emits_one_property_state_with_the_handle_position() {
        val rig = loaded()
        rig.handle.facts = facts(positionMs = 12_000L)
        rig.core.tick()
        assertEquals(listOf("state"), rig.kinds)
        val state = rig.events.single() as PlayerEvent.State
        assertEquals("property", state.cause)
        assertEquals(12.0, state.snapshot.positionSeconds)
    }

    @Test
    fun tick_emits_one_event_per_tick_each_with_the_current_position() {
        val rig = loaded()
        val positions = listOf(1_000L, 2_000L, 3_000L, 10_000L, 20_000L)
        for (position in positions) {
            rig.handle.facts = facts(positionMs = position)
            rig.core.tick()
        }
        assertEquals(List(positions.size) { "state" }, rig.kinds)
        assertEquals(listOf(1.0, 2.0, 3.0, 10.0, 20.0), propertyStates(rig).map { it.snapshot.positionSeconds })
    }

    @Test
    fun tick_after_loaded_but_before_the_first_frame_still_reports_the_position() {
        val rig = EngineRig()
        rig.core.launch(original())
        rig.core.signal(EngineSignal.Ready)
        rig.events.clear()
        rig.handle.facts = facts(positionMs = 4_000L)
        rig.core.tick()
        assertEquals(listOf(4.0), propertyStates(rig).map { it.snapshot.positionSeconds })
        assertEquals(listOf("state"), rig.kinds)
    }

    @Test
    fun tick_while_paused_reports_the_position_and_the_pause() {
        val rig = loaded()
        rig.core.setPaused(true)
        rig.events.clear()
        rig.handle.facts = facts(positionMs = 7_000L, playWhenReady = false)
        rig.core.tick()
        val state = propertyStates(rig).single()
        assertEquals(7.0, state.snapshot.positionSeconds)
        assertTrue(state.snapshot.paused, "the snapshot says paused")
    }

    @Test
    fun tick_after_ended_emits_nothing() {
        val rig = loaded()
        rig.core.signal(EngineSignal.Ended)
        rig.events.clear()
        rig.core.tick()
        rig.core.tick()
        assertEquals(emptyList<String>(), rig.kinds)
    }

    @Test
    fun tick_after_a_failure_emits_nothing() {
        val rig = loaded()
        rig.core.signal(EngineSignal.Failed(4003, emptyList()))
        rig.events.clear()
        rig.core.tick()
        rig.core.tick()
        assertEquals(emptyList<String>(), rig.kinds)
    }

    @Test
    fun tick_after_stop_emits_nothing() {
        val rig = loaded()
        rig.core.stop()
        rig.events.clear()
        rig.core.tick()
        rig.core.tick()
        assertEquals(emptyList<String>(), rig.kinds)
    }

    @Test
    fun tick_after_a_new_launch_waits_for_that_launch_to_load() {
        val rig = loaded()
        rig.core.launch(original(startPositionSeconds = 30.0))
        rig.events.clear()
        rig.core.tick()
        assertEquals(emptyList<String>(), rig.kinds)

        rig.core.signal(EngineSignal.Ready)
        rig.events.clear()
        rig.handle.facts = facts(positionMs = 31_000L)
        rig.core.tick()
        assertEquals(listOf(31.0), propertyStates(rig).map { it.snapshot.positionSeconds })
    }

    @Test
    fun tick_reads_no_handle_call_beyond_its_facts() {
        val rig = loaded()
        val before = rig.handle.calls.toList()
        rig.core.tick()
        assertEquals(before, rig.handle.calls, "a tick neither plays, pauses, seeks nor releases")
    }
}
