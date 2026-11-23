package dev.octave.player

import android.view.Surface

// The one native link between the player view and an Android engine (T8-01, D7): the view offers its surface here
// and an engine (T8-02) listens for it. React is not on this path. Android-only, outside the seam a Swift engine
// mirrors.
object VideoSurfaceSlot {
    private var current: Surface? = null
    private var listener: ((Surface?) -> Unit)? = null

    @Synchronized
    fun offer(surface: Surface) {
        current = surface
        listener?.invoke(surface)
    }

    // Withdraws the surface only when it is the one offered last.
    @Synchronized
    fun withdraw(surface: Surface) {
        if (current !== surface) return
        current = null
        listener?.invoke(null)
    }

    // The engine's one listener; it hears the current surface at once, then every change.
    @Synchronized
    fun setListener(listener: ((Surface?) -> Unit)?) {
        this.listener = listener
        listener?.invoke(current)
    }
}
