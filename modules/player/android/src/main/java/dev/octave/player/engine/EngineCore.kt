package dev.octave.player.engine

import dev.octave.player.seam.LaunchRequest
import dev.octave.player.seam.PlaybackDiagnostics
import dev.octave.player.seam.PlaybackSnapshot
import dev.octave.player.seam.PlayerEngineException
import dev.octave.player.seam.PlayerErrorCode
import dev.octave.player.seam.PlayerEvent
import dev.octave.player.seam.TrackType

// The engine's rules E1 to E11 (docs/specs/T8-02.md, "The engine core"), in plain Kotlin: one PlayerHandle per launch,
// and the port's events from the handle's signals. It runs only on the main thread (Media3Engine's rule), so it holds
// no lock. A launch emits at most one `loaded`, one `first-frame` and one `ended`.
class EngineCore(
    private val newHandle: (LaunchRequest.Original) -> PlayerHandle,
    private val emit: (PlayerEvent) -> Unit,
) {
    private var handle: PlayerHandle? = null
    private var request: LaunchRequest.Original? = null
    private var surface: Any? = null

    // The state of the current launch; reset by launch.
    private var loaded = false
    private var firstFrameSeen = false
    private var firstFrameSent = false
    private var seekPending = false
    private var ended = false
    private var failed = false
    private var decoder = DecoderFacts.NONE

    // Whether `candidate` is the current launch's handle; Media3Engine drops the signals of any other (E3a).
    fun isCurrent(candidate: PlayerHandle): Boolean = handle != null && handle === candidate

    // E1.
    fun launch(launch: LaunchRequest) {
        val original = launch as? LaunchRequest.Original ?: throw PlayerEngineException(PlayerErrorCode.UNSUPPORTED_REQUEST)
        stop()
        loaded = false
        firstFrameSeen = false
        firstFrameSent = false
        seekPending = false
        ended = false
        failed = false
        decoder = DecoderFacts.NONE
        val next = newHandle(original)
        handle = next
        request = original
        next.setSurface(surface)
        next.prepare(original.url, (original.startPositionSeconds * 1000).toLong())
        next.setPlayWhenReady(true)
    }

    // E4.
    fun setPaused(paused: Boolean) {
        val current = live()
        current.setPlayWhenReady(!paused)
        emit(PlayerEvent.State(snapshot(current), "pause"))
    }

    // E4: the `state` with cause `seek` goes out when the seek lands (SeekProcessed).
    fun seek(positionSeconds: Double) {
        val current = live()
        if (!positionSeconds.isFinite() || positionSeconds < 0) throw PlayerEngineException(PlayerErrorCode.UNSUPPORTED_REQUEST)
        // A player may report the seek while seekTo runs (ExoPlayer does, on its own looper), so it is pending first.
        seekPending = true
        current.seekTo((positionSeconds * 1000).toLong())
    }

    // E10: track mapping is T8-10.
    @Suppress("UNUSED_PARAMETER")
    fun selectTrack(type: TrackType, playerId: Int?) {
        throw PlayerEngineException(PlayerErrorCode.UNSUPPORTED_REQUEST)
    }

    // E9: clear the surface, stop, release, once; `ended` with reason `stopped` unless the launch already ended.
    fun stop() {
        val current = handle ?: return
        val last = snapshot(current)
        handle = null
        request = null
        current.setSurface(null)
        current.stop()
        current.release()
        if (!ended) {
            ended = true
            emit(PlayerEvent.Ended("stopped", last))
        }
    }

    // The view's current surface, or null when it went; the handle has it at once.
    fun surface(next: Any?) {
        surface = next
        handle?.setSurface(next)
    }

    // E2, E3, E5 to E8. Nothing is emitted with no active launch or after the launch failed (E3a).
    fun signal(signal: EngineSignal) {
        val current = handle ?: return
        if (failed) return
        when (signal) {
            EngineSignal.Buffering -> Unit
            EngineSignal.Ready -> {
                if (!loaded) {
                    loaded = true
                    emit(PlayerEvent.Loaded(snapshot(current)))
                    if (firstFrameSeen) sendFirstFrame()
                }
            }
            EngineSignal.FirstFrameRendered -> {
                firstFrameSeen = true
                // `loaded` always comes first; a frame presented before Ready is announced right after `loaded`.
                if (loaded) sendFirstFrame()
            }
            EngineSignal.SeekProcessed -> {
                if (seekPending) {
                    seekPending = false
                    emit(PlayerEvent.State(snapshot(current), "seek"))
                }
            }
            EngineSignal.Ended -> {
                if (!ended) {
                    ended = true
                    emit(PlayerEvent.Ended("eof", snapshot(current)))
                }
            }
            is EngineSignal.TracksKnown -> if (!decodable(signal)) fail(PlayerErrorCode.DECODER_UNAVAILABLE)
            is EngineSignal.DecoderInitialized -> {
                decoder = DecoderFacts.read(signal.name, signal.hardwareAccelerated, signal.softwareOnly, signal.sdkInt)
                emit(PlayerEvent.State(snapshot(current), "property"))
            }
            is EngineSignal.Failed -> fail(PlaybackErrors.codeFor(signal.mediaCode, signal.causes))
        }
    }

    private fun sendFirstFrame() {
        if (firstFrameSent) return
        firstFrameSent = true
        emit(PlayerEvent.FirstFrame)
    }

    // E8: `error`, then `ended` with reason `error`. The handle stays until the coordinator's stop.
    private fun fail(code: PlayerErrorCode) {
        failed = true
        emit(PlayerEvent.Error(code))
        if (!ended) {
            ended = true
            emit(PlayerEvent.Ended("error"))
        }
    }

    // E6: every embedded video or audio stream the request lists needs a track the player found and can decode.
    private fun decodable(tracks: EngineSignal.TracksKnown): Boolean {
        val listed = request?.tracks.orEmpty().filter { !it.external }
        val video = listed.any { it.type.equals("Video", ignoreCase = true) }
        val audio = listed.any { it.type.equals("Audio", ignoreCase = true) }
        if (video && !(tracks.videoPresent && tracks.videoSupported)) return false
        if (audio && !(tracks.audioPresent && tracks.audioSupported)) return false
        return true
    }

    private fun live(): PlayerHandle = handle ?: throw PlayerEngineException(PlayerErrorCode.UNSUPPORTED_REQUEST)

    // E10, E11: no string comes from a player message; what T8-06 fills is null until then.
    private fun snapshot(current: PlayerHandle): PlaybackSnapshot {
        val facts = current.facts()
        return PlaybackSnapshot(
            positionSeconds = facts.positionMs / 1000.0,
            durationSeconds = facts.durationMs?.let { it / 1000.0 },
            paused = !facts.playWhenReady,
            buffering = facts.buffering,
            volume = 100.0,
            muted = false,
            audioTrack = null,
            subtitleTrack = null,
            tracks = emptyList(),
            diagnostics = PlaybackDiagnostics(
                decodeMode = decoder.decodeMode,
                decodeLabel = decoder.decodeLabel,
                videoCodec = null,
                bitDepth = null,
                width = facts.width,
                height = facts.height,
                droppedFrames = facts.droppedFrames,
            ),
            video = null,
            audio = null,
            bufferedSeconds = null,
        )
    }
}
