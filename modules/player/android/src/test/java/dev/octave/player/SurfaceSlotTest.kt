package dev.octave.player

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T8-01 review: the slot behind VideoSurfaceSlot. With two views alive (a screen transition), withdrawing the newer
// surface hands the engine the older one, which is still valid, instead of no surface.
class SurfaceSlotTest {
    private class Surface(val name: String) {
        override fun toString() = name
    }

    private val older = Surface("older")
    private val newer = Surface("newer")

    private fun listened(slot: SurfaceSlot<Surface>): MutableList<Surface?> {
        val heard = mutableListOf<Surface?>()
        slot.setListener { heard += it }
        return heard
    }

    @Test
    fun the_listener_hears_the_current_surface_at_once_then_every_change() {
        val slot = SurfaceSlot<Surface>()
        slot.offer(older)
        val heard = listened(slot)
        slot.withdraw(older)
        assertEquals(listOf(older, null), heard)
    }

    @Test
    fun withdrawing_the_newer_of_two_surfaces_restores_the_older() {
        val slot = SurfaceSlot<Surface>()
        val heard = listened(slot)
        slot.offer(older)
        slot.offer(newer)
        slot.withdraw(newer)
        slot.withdraw(older)
        assertEquals(listOf(null, older, newer, older, null), heard)
    }

    @Test
    fun withdrawing_a_surface_that_is_not_current_is_silent() {
        val slot = SurfaceSlot<Surface>()
        val heard = listened(slot)
        slot.offer(older)
        slot.offer(newer)
        slot.withdraw(older)
        slot.withdraw(older)
        slot.withdraw(newer)
        assertEquals(listOf(null, older, newer, null), heard)
    }

    @Test
    fun a_surface_offered_again_becomes_current_once() {
        val slot = SurfaceSlot<Surface>()
        val heard = listened(slot)
        slot.offer(older)
        slot.offer(newer)
        slot.offer(older)
        slot.withdraw(older)
        slot.withdraw(newer)
        assertEquals(listOf(null, older, newer, older, newer, null), heard)
    }

    @Test
    fun a_cleared_listener_hears_nothing() {
        val slot = SurfaceSlot<Surface>()
        val heard = listened(slot)
        slot.setListener(null)
        slot.offer(older)
        assertEquals(listOf<Surface?>(null), heard)
    }
}
