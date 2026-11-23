package dev.octave.player.engine

// One player for one launch, as EngineCore drives it (docs/specs/T8-02.md, "The engine core"). Media3Handle implements
// it over one ExoPlayer; the JVM tests use a fake. Every call comes on the main thread. Plain Kotlin, so a Swift
// engine can mirror it.
interface PlayerHandle {
    fun prepare(url: String, startPositionMs: Long)

    fun setPlayWhenReady(play: Boolean)

    fun seekTo(positionMs: Long)

    // The current video surface, or null when there is none. Typed Any so this package names no Android class.
    fun setSurface(surface: Any?)

    fun stop()

    fun release()

    fun facts(): HandleFacts
}

// What a snapshot reads from the player, in its milliseconds. Null where the player does not know yet.
class HandleFacts(
    val positionMs: Long,
    val durationMs: Long?,
    val playWhenReady: Boolean,
    val buffering: Boolean,
    val droppedFrames: Int,
    val width: Int?,
    val height: Int?,
)
