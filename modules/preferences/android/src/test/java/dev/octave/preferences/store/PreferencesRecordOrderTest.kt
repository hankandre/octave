package dev.octave.preferences.store

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T9-02 (D4): the store accepts the record only in the order the core's encoder writes it, version first and localMbps
// before remoteMbps, so it accepts exactly the 81 texts of `accepted` in the shared vectors and no reordering of them.
class PreferencesRecordOrderTest {
    private val choices = listOf("120", "80", "40", "20", "10", "8", "4", "2")
    private val options: List<String?> = listOf(null) + choices

    private fun limitOrders(local: String?, remote: String?): List<String> {
        val pairs = listOfNotNull(local?.let { "\"localMbps\":$it" }, remote?.let { "\"remoteMbps\":$it" })
        val orders = if (pairs.size == 2) listOf(pairs, pairs.reversed()) else listOf(pairs)
        return orders.map { "{" + it.joinToString(",") + "}" }
    }

    private fun recordOrders(limits: String): List<String> = listOf(
        "{\"version\":1,\"streamingLimits\":$limits}",
        "{\"streamingLimits\":$limits,\"version\":1}",
    )

    @Test
    fun only_the_encoder_order_is_accepted_among_every_reordering() {
        val encoderOrder = mutableSetOf<String>()
        val everyOrder = mutableSetOf<String>()
        for (local in options) {
            for (remote in options) {
                val limits = limitOrders(local, remote)
                encoderOrder.add(recordOrders(limits.first()).first())
                limits.forEach { everyOrder.addAll(recordOrders(it)) }
            }
        }
        assertEquals(81, encoderOrder.size)
        assertEquals(290, everyOrder.size)
        assertEquals(encoderOrder, everyOrder.filter { PreferencesStore.isAllowedRecord(it) }.toSet())
    }
}
