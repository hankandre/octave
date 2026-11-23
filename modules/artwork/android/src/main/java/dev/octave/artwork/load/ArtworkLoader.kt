package dev.octave.artwork.load

import dev.octave.session.http.ArtworkAnswer
import dev.octave.session.http.ArtworkRequest
import dev.octave.session.http.PreparedArtwork
import dev.octave.session.http.SessionId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

// The loader behind the artwork view (T3-11; docs/specs/T3-11.md, "The loader"). Plain Kotlin, so a Swift loader can
// mirror it: the fetch, the decoder and the registry's held-or-not answer come in as functions.
//
// - A cached image is served only while `holds(session)`; a load for a session no longer held is Failed and fetches
//   nothing. Every load first drops the cached entries of each session no longer held, so an ended session's images
//   leave the cache at the next load for any session, and a fetch that finishes after its session ended is not cached.
// - A miss prepares the request, executes it with a 15 s timeout and decodes it at the key's width, all off the calling
//   thread and at most `parallelism` at once. A success is cached; a failure is returned and not cached.
// - Cancelling the coroutine of a load cancels its request, and a cancelled load caches nothing.
class ArtworkLoader(
    private val source: (SessionId, ArtworkRequest) -> PreparedArtwork?,
    private val decoder: ArtworkDecoder,
    private val holds: (SessionId) -> Boolean,
    cacheBytes: Long,
    parallelism: Int = 4,
) {
    sealed class Result {
        class Loaded(val image: Any) : Result() {
            override fun toString(): String = "Loaded"
        }

        object Failed : Result() {
            override fun toString(): String = "Failed"
        }
    }

    private val cache = ByteBoundedLru<ArtworkKey>(cacheBytes)
    private val work = Dispatchers.IO.limitedParallelism(parallelism)
    private val cachedSessions = mutableSetOf<SessionId>()

    suspend fun load(key: ArtworkKey): Result {
        dropEndedSessions()
        if (!holds(key.session)) return Result.Failed
        cache.get(key)?.let { return Result.Loaded(it.image) }
        val prepared = try {
            source(key.session, key.request())
        } catch (_: Exception) {
            null
        } ?: return Result.Failed
        val decoded = fetchAndDecode(prepared, key.width) ?: return Result.Failed
        if (!holds(key.session)) return Result.Failed
        synchronized(cachedSessions) {
            cachedSessions += key.session
            cache.put(key, decoded)
        }
        return Result.Loaded(decoded.image)
    }

    private fun dropEndedSessions() = synchronized(cachedSessions) {
        val ended = cachedSessions.filterNot(holds).toSet()
        if (ended.isNotEmpty()) {
            cachedSessions.removeAll(ended)
            cache.removeIf { it.session in ended }
        }
    }

    // Runs on the limited dispatcher; a cancel of the caller cancels the request at once, since execute blocks.
    private suspend fun fetchAndDecode(prepared: PreparedArtwork, width: Int): Decoded? = coroutineScope {
        val job = async(work) {
            try {
                when (val answer = prepared.execute(TIMEOUT_MS)) {
                    is ArtworkAnswer.Bytes -> decoder.decode(answer.bytes, width)
                    is ArtworkAnswer.Failed -> null
                }
            } catch (_: Exception) {
                null
            } catch (_: OutOfMemoryError) {
                null
            }
        }
        try {
            job.await()
        } catch (cancelled: CancellationException) {
            prepared.cancel()
            throw cancelled
        }
    }

    companion object {
        const val TIMEOUT_MS = 15_000L
    }
}
