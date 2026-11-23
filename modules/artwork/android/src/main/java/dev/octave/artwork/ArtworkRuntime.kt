package dev.octave.artwork

import android.app.ActivityManager
import android.content.Context
import dev.octave.artwork.load.ArtworkLoader
import dev.octave.session.http.ArtworkFetch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

// The one loader of the process and the scope the views load on (T3-11). The cache budget is
// min(memoryClass MiB / 8, 32 MiB), read once (docs/specs/T3-11.md, D7). The registry is named in full at its one use,
// so its held-or-not answer is the only part of a session this module reads.
internal object ArtworkRuntime {
    private const val MIB = 1024L * 1024
    private const val MAX_CACHE = 32 * MIB

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    @Volatile
    private var built: ArtworkLoader? = null

    fun loader(context: Context): ArtworkLoader = built ?: synchronized(this) {
        built ?: ArtworkLoader(
            source = ArtworkFetch::prepare,
            decoder = BitmapArtworkDecoder,
            holds = { dev.octave.session.http.SessionRegistry.holds(it) },
            cacheBytes = cacheBytes(context),
        ).also { built = it }
    }

    private fun cacheBytes(context: Context): Long {
        val manager = context.applicationContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val memoryClass = manager?.memoryClass ?: 0
        return if (memoryClass <= 0) MAX_CACHE else minOf(memoryClass * MIB / 8, MAX_CACHE)
    }
}
