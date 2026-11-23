package dev.octave.artwork.load

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.asExecutor
import kotlinx.coroutines.suspendCancellableCoroutine

// The BlurHash previews of the process (T3-39; docs/specs/T3-39.md, "The preview loader"). A preview is decoded on
// `work`, never on the caller's thread, and kept in a byte-bounded LRU keyed by the hash string alone (the hash is not
// a credential, D6), so a recycled card draws it at mount through cached() with no decode. A refused hash (null) and a
// cancelled load cache nothing. An evicted preview is dropped, never recycled. It makes no request.
class PreviewLoader(
    private val decode: (String) -> Decoded?,
    budgetBytes: Long,
    work: CoroutineDispatcher,
) {
    private val cache = ByteBoundedLru<String>(budgetBytes)
    private val executor = work.asExecutor()

    fun cached(hash: String): Decoded? = cache.get(hash)

    suspend fun load(hash: String): Decoded? {
        cache.get(hash)?.let { return it }
        val decoded = decodeOnWork(hash) ?: return null
        cache.put(hash, decoded)
        return decoded
    }

    // The decode is one short, uninterruptible task, so it runs as a plain task on `work` rather than as a coroutine
    // there; a load cancelled meanwhile resumes with the cancellation and its result is dropped uncached.
    private suspend fun decodeOnWork(hash: String): Decoded? = suspendCancellableCoroutine { continuation ->
        executor.execute {
            if (continuation.isActive) continuation.resumeWith(runCatching { decode(hash) })
        }
    }
}
