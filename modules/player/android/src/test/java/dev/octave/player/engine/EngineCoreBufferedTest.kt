package dev.octave.player.engine

import dev.octave.player.engine.EngineSamples.ALL_PLAYABLE
import dev.octave.player.engine.EngineSamples.original
import dev.octave.player.seam.PlayerEvent
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T8-04, D11: the snapshot's bufferedSeconds is the handle's last buffered timestamp, null while the handle has none.
class EngineCoreBufferedTest {
    private fun facts(bufferedMs: Long?) = HandleFacts(
        positionMs = 10_000L,
        durationMs = 330_000L,
        playWhenReady = true,
        buffering = false,
        droppedFrames = 0,
        width = 1280,
        height = 720,
        bufferedMs = bufferedMs,
    )

    private fun tickWith(bufferedMs: Long?): Double? {
        val rig = EngineRig()
        rig.core.launch(original())
        rig.core.signal(ALL_PLAYABLE)
        rig.core.signal(EngineSignal.Ready)
        rig.events.clear()
        rig.handle.facts = facts(bufferedMs)
        rig.core.tick()
        return (rig.events.single() as PlayerEvent.State).snapshot.bufferedSeconds
    }

    @Test
    fun buffered_seconds_come_from_the_handle() {
        assertEquals(42.5, tickWith(42_500L))
    }

    @Test
    fun buffered_seconds_are_null_while_the_handle_has_none() {
        assertEquals(null, tickWith(null))
    }
}
