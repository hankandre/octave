package dev.octave.artwork.load

// A map in access order bounded by the sum of its entries' byte sizes, under one lock. An entry larger than the whole
// budget is not kept. An evicted value is only dropped, never recycled: a mounted view may still draw it.
internal class ByteBoundedLru<K : Any>(private val budget: Long) {
    private class Entry(val value: Decoded)

    private val map = LinkedHashMap<K, Entry>(16, 0.75f, true)
    private var bytes = 0L

    @Synchronized
    fun get(key: K): Decoded? = map[key]?.value

    @Synchronized
    fun put(key: K, value: Decoded) {
        map.remove(key)?.let { bytes -= it.value.byteCount }
        if (value.byteCount > budget) return
        map[key] = Entry(value)
        bytes += value.byteCount
        val oldest = map.entries.iterator()
        while (bytes > budget && oldest.hasNext()) {
            val eldest = oldest.next()
            bytes -= eldest.value.value.byteCount
            oldest.remove()
        }
    }

    @Synchronized
    fun removeIf(predicate: (K) -> Boolean) {
        val entries = map.entries.iterator()
        while (entries.hasNext()) {
            val entry = entries.next()
            if (predicate(entry.key)) {
                bytes -= entry.value.value.byteCount
                entries.remove()
            }
        }
    }
}
