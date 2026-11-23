package dev.octave.artwork

import android.content.Context
import android.graphics.Bitmap
import android.widget.ImageView
import dev.octave.artwork.load.ArtworkKey
import dev.octave.artwork.load.ArtworkLoader
import dev.octave.session.http.SessionId
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

// The artwork view (T3-11): one ImageView filling it, CENTER_CROP and transparent until a bitmap is set, so the
// surface2 placeholder React draws under it shows through. It takes the five props, builds the key once a batch of
// props is in, and loads through ArtworkRuntime's loader. It emits onArtworkState { state: "loaded" | "failed" } at
// most once per key; a result for a key that is no longer current is dropped. A failure clears the bitmap.
class OctaveArtworkView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onArtworkState by EventDispatcher<Map<String, Any>>()
    private val image = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        background = null
    }

    var session: String? = null
    var itemId: String? = null
    var imageType: String? = null
    var tag: String? = null
    var drawnWidth: Double? = null

    private var current: ArtworkKey? = null
    private var reported = false
    private var started = false
    private var job: Job? = null

    init {
        addView(image)
    }

    // React lays this view out; the image fills it.
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        val w = right - left
        val h = bottom - top
        image.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
        image.layout(0, 0, w, h)
    }

    // Called once a batch of props is in.
    fun propsUpdated() {
        val key = keyOf()
        if (started && key == current) return
        started = true
        job?.cancel()
        image.setImageDrawable(null)
        current = key
        reported = false
        if (key == null) {
            report(null, "failed")
            return
        }
        job = ArtworkRuntime.scope.launch {
            val result = ArtworkRuntime.loader(context).load(key)
            if (current != key) return@launch
            when (result) {
                is ArtworkLoader.Result.Loaded -> {
                    image.setImageBitmap(result.image as Bitmap)
                    report(key, "loaded")
                }
                is ArtworkLoader.Result.Failed -> {
                    image.setImageDrawable(null)
                    report(key, "failed")
                }
            }
        }
    }

    // Cancels the load and drops the bitmap; the cache keeps it.
    fun destroy() {
        job?.cancel()
        job = null
        current = null
        image.setImageDrawable(null)
    }

    private fun keyOf(): ArtworkKey? {
        val id = SessionId.parse(session ?: return null) ?: return null
        val width = drawnWidth ?: return null
        return ArtworkKey.of(id, itemId ?: return null, imageType ?: return null, tag ?: return null, width)
    }

    private fun report(key: ArtworkKey?, state: String) {
        if (reported || current != key) return
        reported = true
        onArtworkState(mapOf("state" to state))
    }
}
