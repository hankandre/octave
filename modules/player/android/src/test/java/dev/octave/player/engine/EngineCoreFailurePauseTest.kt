package dev.octave.player.engine

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T8-02 review finding (E8): a launch that fails keeps its handle until the coordinator's stop, but plays nothing in
// the meantime, so a file with sound and no decodable picture is not heard behind the error. Not frozen.
class EngineCoreFailurePauseTest {
    private fun launched(): EngineRig {
        val rig = EngineRig()
        rig.core.launch(EngineSamples.original())
        rig.handle.calls.clear()
        return rig
    }

    @Test
    fun a_launch_with_no_decodable_video_is_paused_when_it_fails() {
        val rig = launched()
        rig.core.signal(EngineSignal.TracksKnown(videoPresent = false, videoSupported = false, audioPresent = true, audioSupported = true))
        assertEquals(listOf("error", "ended"), rig.kinds)
        assertEquals(listOf("setPlayWhenReady:false"), rig.handle.calls)
    }

    @Test
    fun a_player_error_pauses_the_handle_it_keeps() {
        val rig = launched()
        rig.core.signal(EngineSignal.Failed(4003, emptyList()))
        assertTrue("setPlayWhenReady:false" in rig.handle.calls, rig.handle.calls.toString())
        assertFalse("release" in rig.handle.calls, rig.handle.calls.toString())
    }
}
