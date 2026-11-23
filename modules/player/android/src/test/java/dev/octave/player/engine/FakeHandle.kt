package dev.octave.player.engine

import dev.octave.player.seam.LaunchRequest
import dev.octave.player.seam.MediaTrack
import dev.octave.player.seam.PlayerEvent
import dev.octave.session.http.SessionId

// A PlayerHandle for the frozen T8-02 engine tests (docs/specs/T8-02.md, "The engine core"). It records every call
// as a word, in order, and answers `facts()` with whatever the test set. It plays nothing and sends nothing.
//
// The contract frozen here, beside the spec's own names (PlayerHandle, EngineSignal, EngineCore):
// - HandleFacts is built with the named arguments positionMs: Long, durationMs: Long?, playWhenReady: Boolean,
//   buffering: Boolean, droppedFrames: Int, width: Int?, height: Int? (the spec's "position, duration,
//   play-when-ready, buffering, dropped frames, video size", in the handle's milliseconds).
class FakeHandle(val request: LaunchRequest.Original) : PlayerHandle {
    val calls = mutableListOf<String>()
    var facts = HandleFacts(
        positionMs = 0L,
        durationMs = 10_000L,
        playWhenReady = true,
        buffering = false,
        droppedFrames = 0,
        width = 1280,
        height = 720,
    )

    override fun prepare(url: String, startPositionMs: Long) {
        calls += "prepare:$url:$startPositionMs"
    }

    override fun setPlayWhenReady(play: Boolean) {
        calls += "setPlayWhenReady:$play"
    }

    override fun seekTo(positionMs: Long) {
        calls += "seekTo:$positionMs"
    }

    override fun setSurface(surface: Any?) {
        calls += "setSurface:${surface ?: "null"}"
    }

    override fun stop() {
        calls += "stop"
    }

    override fun release() {
        calls += "release"
    }

    override fun facts(): HandleFacts = facts
}

// An EngineCore with fake handles and a list of what it emitted.
class EngineRig {
    val handles = mutableListOf<FakeHandle>()
    val events = mutableListOf<PlayerEvent>()
    val core = EngineCore({ request -> FakeHandle(request).also { handles += it } }, { events += it })

    val handle: FakeHandle get() = handles.last()
    val kinds: List<String> get() = events.map { it.kind }

    fun count(kind: String): Int = events.count { it.kind == kind }
}

object EngineSamples {
    val SESSION: SessionId = checkNotNull(SessionId.parse("3f1c9a7e5b2d4c6e8a0b1c2d3e4f5a6b"))
    const val URL = "https://media.test/Videos/a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4/stream?Static=true&MediaSourceId=a1b2c3d4"
    const val MASTER_URL = "https://media.test/videos/a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4/master.m3u8?MediaSourceId=a1b2c3d4"
    const val SERVER_URL = "https://media.test"

    val VIDEO = MediaTrack(index = 0, type = "Video", displayTitle = "1080p H264", external = false)
    val AUDIO = MediaTrack(index = 1, type = "Audio", displayTitle = "English - AAC - Stereo", external = false)

    fun original(
        tracks: List<MediaTrack> = listOf(VIDEO, AUDIO),
        startPositionSeconds: Double = 0.0,
    ) = LaunchRequest.Original(
        session = SESSION,
        startPositionSeconds = startPositionSeconds,
        tracks = tracks,
        audioStreamIndex = null,
        subtitleStreamIndex = null,
        url = URL,
    )

    fun hls() = LaunchRequest.Hls(
        session = SESSION,
        startPositionSeconds = 0.0,
        tracks = listOf(VIDEO, AUDIO),
        audioStreamIndex = null,
        subtitleStreamIndex = null,
        masterUrl = MASTER_URL,
        serverUrl = SERVER_URL,
        mediaKind = dev.octave.player.seam.MediaKind.VIDEOS,
    )

    val ALL_PLAYABLE = EngineSignal.TracksKnown(videoPresent = true, videoSupported = true, audioPresent = true, audioSupported = true)
}
