package dev.octave.player

import android.view.Surface

// The one native link between the player view and an Android engine (T8-01, D7): the view offers its surface here
// and an engine (T8-02) listens for it. React is not on this path. Android-only, outside the seam a Swift engine
// mirrors. SurfaceSlot holds the rules and the listener's contract.
object VideoSurfaceSlot {
    private val slot = SurfaceSlot<Surface>()

    fun offer(surface: Surface) = slot.offer(surface)

    fun withdraw(surface: Surface) = slot.withdraw(surface)

    fun setListener(listener: ((Surface?) -> Unit)?) = slot.setListener(listener)
}
