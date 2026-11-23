package dev.octave.player.engine

import dev.octave.player.seam.PlayerEvent
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T8-02 item 4, found on the emulator (2026-11-23): ExoPlayer reports a seek's position discontinuity while seekTo runs,
// on its own looper, so EngineCore must already hold the seek as pending when the handle signals it. Not frozen.
class EngineCoreSyncSignalTest {
    private class SignallingHandle(private val core: () -> EngineCore) : PlayerHandle {
        override fun prepare(url: String, startPositionMs: Long) = Unit
        override fun setPlayWhenReady(play: Boolean) = Unit
        override fun seekTo(positionMs: Long) = core().signal(EngineSignal.SeekProcessed)
        override fun setSurface(surface: Any?) = Unit
        override fun stop() = Unit
        override fun release() = Unit
        override fun facts() = HandleFacts(positionMs = 6_000L, durationMs = 10_000L, playWhenReady = true, buffering = false, droppedFrames = 0, width = null, height = null)
    }

    @Test
    fun a_seek_the_player_reports_during_seekTo_emits_one_seek_state() {
        val events = mutableListOf<PlayerEvent>()
        lateinit var core: EngineCore
        core = EngineCore({ SignallingHandle { core } }, { events += it })
        core.launch(EngineSamples.original())
        core.seek(6.0)
        val seeks = events.filterIsInstance<PlayerEvent.State>().filter { it.cause == "seek" }
        assertEquals(1, seeks.size, events.map { it.kind }.toString())
        assertEquals(6.0, seeks.single().snapshot.positionSeconds, 1e-9)
    }
}
