package dev.octave.player

import dev.octave.player.engine.PictureState
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class PictureStatesTest {
    @Test
    fun a_listener_hears_not_awake_before_any_engine_publishes() {
        val heard = mutableListOf<Boolean>()
        PictureStates().addListener { heard += it.awake }
        assertEquals(listOf(false), heard)
    }

    @Test
    fun a_listener_hears_the_current_state_at_once_then_every_change() {
        val slot = PictureStates()
        slot.publish(PictureState(awake = true))
        val heard = mutableListOf<Boolean>()
        slot.addListener { heard += it.awake }
        slot.publish(PictureState(awake = false))
        assertEquals(listOf(true, false), heard)
    }

    @Test
    fun a_removed_listener_hears_nothing_while_another_still_does() {
        val slot = PictureStates()
        val first = mutableListOf<Boolean>()
        val second = mutableListOf<Boolean>()
        val firstListener: (PictureState) -> Unit = { first += it.awake }
        slot.addListener(firstListener)
        slot.addListener { second += it.awake }
        slot.removeListener(firstListener)
        slot.publish(PictureState(awake = true))
        assertEquals(listOf(false), first)
        assertEquals(listOf(false, true), second)
    }
}
