package dev.octave.player

import dev.octave.player.engine.PictureState

// The native link from an Android engine to the player view for the picture's state (T8-04, D12), beside
// VideoSurfaceSlot: the engine publishes, each view listens. React is not on this path. Android-only, outside the
// seam a Swift engine mirrors; PictureState and EngineCore's callback are the part it mirrors.
//
// Contract: a listener hears the current state at once, then every change. The engine publishes and the views
// attach and detach on the main thread, so every listener is called there.
object PictureSlot {
    private val slot = PictureStates()

    fun publish(state: PictureState) = slot.publish(state)

    fun addListener(listener: (PictureState) -> Unit) = slot.addListener(listener)

    fun removeListener(listener: (PictureState) -> Unit) = slot.removeListener(listener)
}

// The state behind PictureSlot, in plain Kotlin so it is tested on the JVM. Not awake until an engine says otherwise.
internal class PictureStates {
    private val listeners = ArrayList<(PictureState) -> Unit>()
    private var current = PictureState(awake = false)

    @Synchronized
    fun publish(state: PictureState) {
        current = state
        listeners.toList().forEach { it(state) }
    }

    @Synchronized
    fun addListener(listener: (PictureState) -> Unit) {
        if (listeners.none { it === listener }) listeners.add(listener)
        listener(current)
    }

    @Synchronized
    fun removeListener(listener: (PictureState) -> Unit) {
        listeners.removeAll { it === listener }
    }
}
