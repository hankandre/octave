package dev.octave.player.engine

import dev.octave.player.engine.EngineSamples.ALL_PLAYABLE
import dev.octave.player.engine.EngineSamples.AUDIO
import dev.octave.player.engine.EngineSamples.URL
import dev.octave.player.engine.EngineSamples.VIDEO
import dev.octave.player.engine.EngineSamples.hls
import dev.octave.player.engine.EngineSamples.original
import dev.octave.player.seam.MediaTrack
import dev.octave.player.seam.PlayerEngineException
import dev.octave.player.seam.PlayerErrorCode
import dev.octave.player.seam.PlayerEvent
import dev.octave.player.seam.TrackType
import dev.octave.session.http.HttpRefusal
import dev.octave.session.http.OctaveHttpException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T8-02 items 2, 4 and 6, and the engine rules E1 to E11 they rest on (docs/specs/T8-02.md, "The engine core").
// EngineCore is plain Kotlin: it drives one PlayerHandle per launch and turns EngineSignals into the port's events.
// Test names group by item, so a Gradle filter selects one item: first_frame_* (item 2), stop_*, pause_*, seek_*
// (item 4), no_decoder_* (item 6), failure_* (item 5), launch_* (item 1), decoder_* and snapshot_* (item 3).
//
// Spec check issue 7 is held here too: a signal that arrives with no active launch (after stop, or after the launch
// failed) emits nothing, and TracksKnown is judged only while the launch is active and has not failed.
class EngineCoreTest {
    private fun launched(tracks: List<MediaTrack> = listOf(VIDEO, AUDIO), start: Double = 0.0): EngineRig =
        EngineRig().apply { core.launch(original(tracks, start)) }

    private fun assertUnsupported(call: () -> Unit) {
        val thrown = assertThrows(PlayerEngineException::class.java) { call() }
        assertEquals(PlayerErrorCode.UNSUPPORTED_REQUEST, thrown.code)
    }

    private fun lastError(rig: EngineRig): PlayerErrorCode? = rig.events.filterIsInstance<PlayerEvent.Error>().lastOrNull()?.code

    // ---- item 1: a launch ----

    @Test
    fun launch_prepares_the_url_at_the_start_position_and_plays() {
        val rig = launched(start = 12.5)
        assertEquals(1, rig.handles.size)
        val calls = rig.handle.calls
        assertTrue("prepare:$URL:12500" in calls, "prepare(url, 12500): $calls")
        assertTrue("setPlayWhenReady:true" in calls, "play when ready: $calls")
        assertFalse("release" in calls, "a launch releases nothing of its own handle: $calls")
    }

    @Test
    fun launch_gives_the_handle_the_current_surface_before_it_prepares() {
        val rig = EngineRig()
        rig.core.surface("surface-1")
        rig.core.launch(original())
        val calls = rig.handle.calls
        val surface = calls.indexOf("setSurface:surface-1")
        val prepare = calls.indexOfFirst { it.startsWith("prepare:") }
        assertTrue(surface >= 0 && prepare >= 0 && surface < prepare, "setSurface before prepare: $calls")
    }

    @Test
    fun launch_hands_a_later_surface_to_the_handle_and_null_when_it_goes() {
        val rig = launched()
        rig.core.surface("surface-2")
        rig.core.surface(null)
        val calls = rig.handle.calls
        assertTrue(calls.indexOf("setSurface:surface-2") < calls.lastIndexOf("setSurface:null"), "the surface, then null: $calls")
    }

    @Test
    fun launch_of_an_hls_request_is_unsupported_and_builds_no_handle() {
        val rig = EngineRig()
        assertUnsupported { rig.core.launch(hls()) }
        assertEquals(0, rig.handles.size)
        assertEquals(emptyList<String>(), rig.kinds)
    }

    @Test
    fun launch_while_playing_releases_the_old_handle_without_a_second_ended() {
        val rig = launched()
        val first = rig.handle
        rig.core.launch(original())
        assertEquals(2, rig.handles.size)
        assertEquals(1, first.calls.count { it == "release" }, "the first handle is released: ${first.calls}")
        assertFalse(rig.handle.calls.contains("release"), "the new handle is live: ${rig.handle.calls}")
        assertTrue(rig.count("ended") <= 1, "at most one ended for the replaced launch: ${rig.kinds}")
    }

    // ---- item 2: first frame (E2, E3) ----

    @Test
    fun first_frame_is_not_emitted_on_prepare_loading_buffering_ready_tracks_or_seek() {
        val rig = launched()
        rig.core.signal(EngineSignal.Buffering)
        rig.core.signal(ALL_PLAYABLE)
        rig.core.signal(EngineSignal.Ready)
        rig.core.seek(3.0)
        rig.core.signal(EngineSignal.SeekProcessed)
        rig.core.signal(EngineSignal.Buffering)
        rig.core.signal(EngineSignal.Ready)
        assertEquals(0, rig.count("first-frame"), "no first-frame before a frame is rendered: ${rig.kinds}")
    }

    @Test
    fun first_frame_is_emitted_once_on_the_rendered_signal_after_loaded() {
        val rig = launched()
        rig.core.signal(EngineSignal.Ready)
        rig.core.signal(EngineSignal.FirstFrameRendered)
        assertEquals(1, rig.count("first-frame"))
        assertEquals(1, rig.count("loaded"))
        assertTrue(rig.kinds.indexOf("loaded") < rig.kinds.indexOf("first-frame"), "loaded, then first-frame: ${rig.kinds}")
    }

    @Test
    fun first_frame_loaded_is_emitted_only_on_the_first_ready_of_a_launch() {
        val rig = launched()
        rig.core.signal(EngineSignal.Ready)
        rig.core.signal(EngineSignal.Buffering)
        rig.core.signal(EngineSignal.Ready)
        assertEquals(1, rig.count("loaded"), rig.kinds.toString())
    }

    @Test
    fun first_frame_is_not_repeated_by_a_second_rendered_signal_after_a_seek() {
        val rig = launched()
        rig.core.signal(EngineSignal.Ready)
        rig.core.signal(EngineSignal.FirstFrameRendered)
        rig.core.seek(5.0)
        rig.core.signal(EngineSignal.SeekProcessed)
        rig.core.signal(EngineSignal.FirstFrameRendered)
        assertEquals(1, rig.count("first-frame"), rig.kinds.toString())
    }

    @Test
    fun first_frame_is_not_emitted_after_stop() {
        val rig = launched()
        rig.core.signal(EngineSignal.Ready)
        rig.core.stop()
        val before = rig.events.size
        rig.core.signal(EngineSignal.FirstFrameRendered)
        assertEquals(before, rig.events.size, "nothing after stop: ${rig.kinds}")
        assertEquals(0, rig.count("first-frame"))
    }

    @Test
    fun first_frame_is_not_emitted_with_no_launch() {
        val rig = EngineRig()
        rig.core.signal(EngineSignal.Ready)
        rig.core.signal(EngineSignal.FirstFrameRendered)
        assertEquals(emptyList<String>(), rig.kinds)
    }

    @Test
    fun first_frame_is_emitted_once_per_launch() {
        val rig = launched()
        rig.core.signal(EngineSignal.Ready)
        rig.core.signal(EngineSignal.FirstFrameRendered)
        rig.core.stop()
        rig.core.launch(original())
        rig.core.signal(EngineSignal.Ready)
        rig.core.signal(EngineSignal.FirstFrameRendered)
        assertEquals(2, rig.count("first-frame"), rig.kinds.toString())
        assertEquals(2, rig.count("loaded"), rig.kinds.toString())
    }

    // ---- item 4: pause, seek and stop (E4, E9) ----

    @Test
    fun pause_sets_play_when_ready_and_emits_state_with_cause_pause() {
        val rig = launched()
        rig.core.signal(EngineSignal.Ready)
        rig.handle.calls.clear()
        rig.core.setPaused(true)
        assertEquals(listOf("setPlayWhenReady:false"), rig.handle.calls)
        val paused = rig.events.last()
        assertTrue(paused is PlayerEvent.State && paused.cause == "pause", "state cause pause: ${rig.kinds}")
        rig.core.setPaused(false)
        assertEquals(listOf("setPlayWhenReady:false", "setPlayWhenReady:true"), rig.handle.calls)
        val resumed = rig.events.last()
        assertTrue(resumed is PlayerEvent.State && resumed.cause == "pause", "state cause pause: ${rig.kinds}")
    }

    @Test
    fun pause_snapshot_says_paused_from_the_handle() {
        val rig = launched()
        rig.handle.facts = HandleFacts(positionMs = 4_000L, durationMs = 10_000L, playWhenReady = false, buffering = false, droppedFrames = 0, width = 1280, height = 720)
        rig.core.setPaused(true)
        val state = rig.events.last() as PlayerEvent.State
        assertTrue(state.snapshot.paused)
        assertEquals(4.0, state.snapshot.positionSeconds, 1e-9)
    }

    @Test
    fun seek_seeks_and_emits_state_with_cause_seek_once_the_position_lands() {
        val rig = launched()
        rig.core.signal(EngineSignal.Ready)
        rig.handle.calls.clear()
        val before = rig.events.size
        rig.core.seek(6.0)
        assertEquals(listOf("seekTo:6000"), rig.handle.calls)
        assertTrue(rig.events.drop(before).none { it is PlayerEvent.State && it.cause == "seek" }, "no seek state before it lands: ${rig.kinds}")
        rig.handle.facts = HandleFacts(positionMs = 6_000L, durationMs = 10_000L, playWhenReady = true, buffering = false, droppedFrames = 0, width = 1280, height = 720)
        rig.core.signal(EngineSignal.SeekProcessed)
        val landed = rig.events.drop(before).filterIsInstance<PlayerEvent.State>().filter { it.cause == "seek" }
        assertEquals(1, landed.size, rig.kinds.toString())
        assertEquals(6.0, landed.single().snapshot.positionSeconds, 1e-9)
    }

    @Test
    fun seek_refuses_a_negative_or_non_finite_position_and_seeks_nowhere() {
        val rig = launched()
        rig.handle.calls.clear()
        for (bad in listOf(-1.0, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertThrows(PlayerEngineException::class.java) { rig.core.seek(bad) }
        }
        assertTrue(rig.handle.calls.none { it.startsWith("seekTo") }, rig.handle.calls.toString())
    }

    @Test
    fun seek_processed_without_a_seek_emits_no_seek_state() {
        val rig = launched()
        rig.core.signal(EngineSignal.SeekProcessed)
        assertTrue(rig.events.none { it is PlayerEvent.State && it.cause == "seek" }, rig.kinds.toString())
    }

    @Test
    fun stop_clears_the_surface_then_stops_then_releases_the_handle_once() {
        val rig = EngineRig()
        rig.core.surface("surface-1")
        rig.core.launch(original())
        rig.handle.calls.clear()
        rig.core.stop()
        assertEquals(listOf("setSurface:null", "stop", "release"), rig.handle.calls)
    }

    @Test
    fun stop_emits_ended_with_reason_stopped_once() {
        val rig = launched()
        rig.core.signal(EngineSignal.Ready)
        rig.core.stop()
        val ended = rig.events.last()
        assertTrue(ended is PlayerEvent.Ended && ended.reason == "stopped", rig.kinds.toString())
        assertEquals(1, rig.count("ended"))
    }

    @Test
    fun stop_a_second_time_releases_nothing_more_and_emits_nothing() {
        val rig = launched()
        rig.core.stop()
        val events = rig.events.size
        rig.core.stop()
        assertEquals(1, rig.handle.calls.count { it == "release" })
        assertEquals(1, rig.handle.calls.count { it == "stop" })
        assertEquals(events, rig.events.size)
    }

    @Test
    fun stop_with_no_launch_emits_nothing() {
        val rig = EngineRig()
        rig.core.stop()
        assertEquals(emptyList<String>(), rig.kinds)
        assertEquals(0, rig.handles.size)
    }

    @Test
    fun stop_then_pause_seek_and_select_track_are_unsupported() {
        val rig = launched()
        rig.core.stop()
        val calls = rig.handle.calls.toList()
        assertUnsupported { rig.core.setPaused(true) }
        assertUnsupported { rig.core.seek(1.0) }
        assertUnsupported { rig.core.selectTrack(TrackType.AUDIO, 1) }
        assertEquals(calls, rig.handle.calls, "nothing reaches a released handle")
    }

    @Test
    fun stop_then_launch_builds_a_new_handle_with_the_current_surface() {
        val rig = EngineRig()
        rig.core.surface("surface-1")
        rig.core.launch(original())
        rig.core.stop()
        rig.core.launch(original())
        assertEquals(2, rig.handles.size)
        val calls = rig.handle.calls
        assertTrue("setSurface:surface-1" in calls, calls.toString())
        assertTrue(calls.any { it.startsWith("prepare:") }, calls.toString())
        assertFalse("release" in calls, calls.toString())
    }

    @Test
    fun stop_drops_every_later_signal_of_the_stopped_handle() {
        val rig = launched()
        rig.core.stop()
        val events = rig.events.size
        rig.core.signal(EngineSignal.Ready)
        rig.core.signal(EngineSignal.Ended)
        rig.core.signal(EngineSignal.TracksKnown(videoPresent = false, videoSupported = false, audioPresent = false, audioSupported = false))
        rig.core.signal(EngineSignal.Failed(2001, emptyList()))
        rig.core.signal(EngineSignal.DecoderInitialized("c2.android.avc.decoder", hardwareAccelerated = false, softwareOnly = true, sdkInt = 36))
        assertEquals(events, rig.events.size, "nothing after stop: ${rig.kinds}")
    }

    @Test
    fun stop_after_a_failure_releases_the_handle_it_kept() {
        val rig = launched()
        rig.core.signal(EngineSignal.Failed(4003, emptyList()))
        assertFalse("release" in rig.handle.calls, "the handle stays until stop (E8): ${rig.handle.calls}")
        rig.core.stop()
        assertEquals(1, rig.handle.calls.count { it == "release" }, rig.handle.calls.toString())
    }

    // ---- E7, E10 ----

    @Test
    fun end_of_file_emits_ended_with_reason_eof_and_a_snapshot() {
        val rig = launched()
        rig.core.signal(EngineSignal.Ready)
        rig.core.signal(EngineSignal.Ended)
        val ended = rig.events.last()
        assertTrue(ended is PlayerEvent.Ended && ended.reason == "eof" && ended.snapshot != null, rig.kinds.toString())
    }

    @Test
    fun select_track_is_unsupported_until_tracks_are_mapped() {
        val rig = launched()
        assertUnsupported { rig.core.selectTrack(TrackType.AUDIO, 1) }
        assertUnsupported { rig.core.selectTrack(TrackType.SUBTITLE, null) }
    }

    // ---- item 3: decoder facts in the snapshot (E5, E11) ----

    @Test
    fun decoder_initialized_emits_state_with_cause_property_and_the_decoder_facts() {
        val rig = launched()
        rig.core.signal(EngineSignal.Ready)
        rig.core.signal(EngineSignal.DecoderInitialized("c2.android.avc.decoder", hardwareAccelerated = false, softwareOnly = true, sdkInt = 36))
        val state = rig.events.last()
        assertTrue(state is PlayerEvent.State && state.cause == "property", rig.kinds.toString())
        val diagnostics = (state as PlayerEvent.State).snapshot.diagnostics
        assertEquals("software", diagnostics.decodeMode)
        assertEquals("c2.android.avc.decoder", diagnostics.decodeLabel)
    }

    @Test
    fun decoder_facts_reach_the_next_snapshot() {
        val rig = launched()
        rig.core.signal(EngineSignal.DecoderInitialized("c2.vendor.hevc.decoder", hardwareAccelerated = true, softwareOnly = false, sdkInt = 34))
        rig.core.signal(EngineSignal.Ready)
        val loaded = rig.events.filterIsInstance<PlayerEvent.Loaded>().single()
        assertEquals("hardware", loaded.snapshot.diagnostics.decodeMode)
        assertEquals("c2.vendor.hevc.decoder", loaded.snapshot.diagnostics.decodeLabel)
    }

    @Test
    fun snapshot_holds_the_handle_facts_and_no_decoder_yet() {
        val rig = launched()
        rig.handle.facts = HandleFacts(positionMs = 1_500L, durationMs = 10_000L, playWhenReady = true, buffering = true, droppedFrames = 3, width = 1920, height = 1080)
        rig.core.signal(EngineSignal.Ready)
        val snapshot = rig.events.filterIsInstance<PlayerEvent.Loaded>().single().snapshot
        assertEquals(1.5, snapshot.positionSeconds, 1e-9)
        assertEquals(10.0, snapshot.durationSeconds!!, 1e-9)
        assertFalse(snapshot.paused)
        assertTrue(snapshot.buffering)
        assertEquals(100.0, snapshot.volume, 1e-9)
        assertFalse(snapshot.muted)
        assertNull(snapshot.audioTrack)
        assertNull(snapshot.subtitleTrack)
        assertEquals(0, snapshot.tracks.size)
        assertEquals("unknown", snapshot.diagnostics.decodeMode)
        assertEquals("", snapshot.diagnostics.decodeLabel)
        assertEquals(3, snapshot.diagnostics.droppedFrames)
        assertEquals(1920, snapshot.diagnostics.width)
        assertEquals(1080, snapshot.diagnostics.height)
    }

    @Test
    fun snapshot_has_no_duration_when_the_handle_does_not_know_it() {
        val rig = launched()
        rig.handle.facts = HandleFacts(positionMs = 0L, durationMs = null, playWhenReady = true, buffering = false, droppedFrames = 0, width = null, height = null)
        rig.core.signal(EngineSignal.Ready)
        val snapshot = rig.events.filterIsInstance<PlayerEvent.Loaded>().single().snapshot
        assertNull(snapshot.durationSeconds)
        assertNull(snapshot.diagnostics.width)
        assertNull(snapshot.diagnostics.height)
    }

    // ---- item 5: a refused redirect (E8) ----

    @Test
    fun failure_from_a_refused_redirect_emits_server_error_then_ended_error() {
        val rig = launched()
        rig.core.signal(EngineSignal.Failed(2001, listOf(java.io.IOException("wrapped"), OctaveHttpException(HttpRefusal.REDIRECT))))
        assertEquals(listOf("error", "ended"), rig.kinds.takeLast(2), rig.kinds.toString())
        assertEquals(PlayerErrorCode.SERVER_ERROR, lastError(rig))
        val ended = rig.events.last() as PlayerEvent.Ended
        assertEquals("error", ended.reason)
    }

    @Test
    fun failure_without_a_refusal_maps_media3_code() {
        val rig = launched()
        rig.core.signal(EngineSignal.Failed(3001, emptyList()))
        assertEquals(PlayerErrorCode.MALFORMED_MEDIA, lastError(rig))
    }

    @Test
    fun failure_from_an_ended_session_is_session_ended() {
        val rig = launched()
        rig.core.signal(EngineSignal.Failed(2001, listOf(OctaveHttpException(HttpRefusal.NO_SESSION))))
        assertEquals(PlayerErrorCode.SESSION_ENDED, lastError(rig))
        assertEquals("error", (rig.events.last() as PlayerEvent.Ended).reason)
    }

    // ---- item 6: no decoder (E6) ----

    private fun tracks(videoPresent: Boolean, videoSupported: Boolean, audioPresent: Boolean, audioSupported: Boolean) =
        EngineSignal.TracksKnown(videoPresent = videoPresent, videoSupported = videoSupported, audioPresent = audioPresent, audioSupported = audioSupported)

    private fun assertDecoderUnavailable(rig: EngineRig) {
        assertEquals(listOf("error", "ended"), rig.kinds.takeLast(2), rig.kinds.toString())
        assertEquals(PlayerErrorCode.DECODER_UNAVAILABLE, lastError(rig))
        assertEquals("error", (rig.events.last() as PlayerEvent.Ended).reason)
    }

    @Test
    fun no_decoder_for_a_listed_video_track_ends_in_decoder_unavailable() {
        val rig = launched()
        rig.core.signal(tracks(videoPresent = true, videoSupported = false, audioPresent = true, audioSupported = true))
        assertDecoderUnavailable(rig)
    }

    @Test
    fun no_decoder_when_a_listed_video_track_is_not_present_in_what_media3_reports() {
        val rig = launched()
        rig.core.signal(tracks(videoPresent = false, videoSupported = false, audioPresent = true, audioSupported = true))
        assertDecoderUnavailable(rig)
    }

    @Test
    fun no_decoder_for_a_listed_audio_track_ends_in_decoder_unavailable() {
        val rig = launched()
        rig.core.signal(tracks(videoPresent = true, videoSupported = true, audioPresent = true, audioSupported = false))
        assertDecoderUnavailable(rig)
    }

    @Test
    fun no_decoder_is_not_judged_for_a_type_the_request_does_not_list() {
        val rig = launched(tracks = listOf(AUDIO))
        rig.core.signal(tracks(videoPresent = false, videoSupported = false, audioPresent = true, audioSupported = true))
        assertTrue(rig.events.none { it is PlayerEvent.Error }, rig.kinds.toString())
    }

    @Test
    fun no_decoder_is_not_judged_for_an_external_track() {
        val external = MediaTrack(index = 2, type = "Audio", displayTitle = "Commentary", external = true)
        val rig = launched(tracks = listOf(VIDEO, external))
        rig.core.signal(tracks(videoPresent = true, videoSupported = true, audioPresent = false, audioSupported = false))
        assertTrue(rig.events.none { it is PlayerEvent.Error }, rig.kinds.toString())
    }

    @Test
    fun no_decoder_error_when_every_listed_track_can_play() {
        val rig = launched()
        rig.core.signal(ALL_PLAYABLE)
        rig.core.signal(EngineSignal.Ready)
        assertTrue(rig.events.none { it is PlayerEvent.Error || it is PlayerEvent.Ended }, rig.kinds.toString())
    }

    @Test
    fun no_decoder_judgement_after_stop() {
        val rig = launched()
        rig.core.stop()
        val events = rig.events.size
        rig.core.signal(tracks(videoPresent = false, videoSupported = false, audioPresent = false, audioSupported = false))
        assertEquals(events, rig.events.size, rig.kinds.toString())
    }

    @Test
    fun no_decoder_judgement_after_the_launch_failed() {
        val rig = launched()
        rig.core.signal(EngineSignal.Failed(2001, emptyList()))
        assertEquals(PlayerErrorCode.NETWORK, lastError(rig))
        val events = rig.events.size
        rig.core.signal(tracks(videoPresent = false, videoSupported = false, audioPresent = false, audioSupported = false))
        assertEquals(events, rig.events.size, "empty tracks after a failure are not a missing decoder: ${rig.kinds}")
    }

    @Test
    fun no_decoder_from_media3_format_codes_is_decoder_unavailable() {
        for (code in listOf(4004, 4005)) {
            val rig = launched()
            rig.core.signal(EngineSignal.Failed(code, emptyList()))
            assertDecoderUnavailable(rig)
        }
    }
}
