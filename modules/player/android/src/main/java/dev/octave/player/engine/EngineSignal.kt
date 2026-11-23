package dev.octave.player.engine

// What a player reports to EngineCore, already reduced to facts: no player text, URL or path rides along. Media3Handle
// sends them from ExoPlayer's callbacks on the main thread.
sealed class EngineSignal {
    object Buffering : EngineSignal()

    object Ready : EngineSignal()

    object Ended : EngineSignal()

    // A frame was presented on the surface (Player.Listener.onRenderedFirstFrame), not merely decoded or loaded.
    object FirstFrameRendered : EngineSignal()

    // A seek landed (a position discontinuity with a seek reason).
    object SeekProcessed : EngineSignal()

    // Whether the player found a video and an audio track, and whether a decoder takes it.
    class TracksKnown(
        val videoPresent: Boolean,
        val videoSupported: Boolean,
        val audioPresent: Boolean,
        val audioSupported: Boolean,
    ) : EngineSignal()

    // The video decoder's name, and what Media3 reports of it for that name (null when Media3 has no entry for it).
    class DecoderInitialized(
        val name: String,
        val hardwareAccelerated: Boolean?,
        val softwareOnly: Boolean?,
        val sdkInt: Int,
    ) : EngineSignal()

    // A playback error: Media3's error code and the cause chain, outermost first. Only each cause's class (and a
    // refusal's code) is read.
    class Failed(val mediaCode: Int, val causes: List<Throwable>) : EngineSignal()
}
