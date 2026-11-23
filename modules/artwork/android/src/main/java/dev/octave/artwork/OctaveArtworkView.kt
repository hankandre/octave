package dev.octave.artwork

import android.content.Context
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.widget.ImageView
import dev.octave.artwork.load.ArtworkKey
import dev.octave.artwork.load.ArtworkLoader
import dev.octave.artwork.load.Decoded
import dev.octave.session.http.SessionId
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

// The artwork view (T3-11, T3-39). Two ImageViews fill it, both transparent until a bitmap is set, so the surface2
// placeholder React draws under it shows through:
// - the preview layer, beneath (FIT_XY, filtered): the 32x32 BlurHash preview of blurHash, from the runtime's
//   PreviewLoader, drawn at once when cached and otherwise once decoded off the main thread. A refused hash draws
//   nothing. The view emits nothing about it.
// - the picture layer (CENTER_CROP): the five T3-11 props build the key once a batch of props is in, and the picture
//   loads through ArtworkRuntime's loader. It emits onArtworkState { state: "loaded" | "failed" } at most once per key;
//   a result for a key that is no longer current is dropped, and a failure clears the bitmap. A view given none of the
//   five (the slot's preview view) loads no picture and emits nothing.
class OctaveArtworkView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onArtworkState by EventDispatcher<Map<String, Any>>()
    private val preview = ImageView(context).apply {
        scaleType = ImageView.ScaleType.FIT_XY
        background = null
    }
    private val image = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        background = null
    }

    var session: String? = null
    var itemId: String? = null
    var imageType: String? = null
    var tag: String? = null
    var drawnWidth: Double? = null
    var blurHash: String? = null

    private var current: ArtworkKey? = null
    private var reported = false
    private var started = false
    private var job: Job? = null

    private var previewHash: String? = null
    private var previewJob: Job? = null

    init {
        addView(preview)
        addView(image)
    }

    // React lays this view out; both layers fill it.
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        val w = right - left
        val h = bottom - top
        for (layer in listOf(preview, image)) {
            layer.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
            layer.layout(0, 0, w, h)
        }
    }

    // Called once a batch of props is in.
    fun propsUpdated() {
        updatePreview()
        if (session == null && itemId == null && imageType == null && tag == null && drawnWidth == null) {
            stopPicture()
            return
        }
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

    // Cancels both loads and drops both bitmaps; the caches keep them.
    fun destroy() {
        stopPicture()
        previewJob?.cancel()
        previewJob = null
        previewHash = null
        preview.setImageDrawable(null)
    }

    private fun stopPicture() {
        job?.cancel()
        job = null
        current = null
        started = false
        image.setImageDrawable(null)
    }

    private fun updatePreview() {
        val hash = blurHash
        if (hash == previewHash) return
        previewJob?.cancel()
        previewJob = null
        preview.setImageDrawable(null)
        previewHash = hash
        if (hash == null) return
        val previews = ArtworkRuntime.previews
        val cached = previews.cached(hash)
        if (cached != null) {
            showPreview(cached)
            return
        }
        previewJob = ArtworkRuntime.scope.launch {
            val result = previews.load(hash)
            if (previewHash == hash && result != null) showPreview(result)
        }
    }

    private fun showPreview(decoded: Decoded) {
        val drawable = BitmapDrawable(resources, decoded.image as Bitmap).apply { isFilterBitmap = true }
        preview.setImageDrawable(drawable)
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
