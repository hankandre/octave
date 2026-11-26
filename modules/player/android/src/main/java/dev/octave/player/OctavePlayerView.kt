package dev.octave.player

import android.content.Context
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import dev.octave.player.engine.PictureState
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// The view that hosts the video (T8-01, item 5): one SurfaceView filling it. It takes no prop, event or function from
// React; it hands its surface to VideoSurfaceSlot natively, where an engine (T8-02) picks it up, and keeps the screen
// on while PictureSlot says the picture is playing (T8-04, D12). keepScreenOn needs no permission.
class OctavePlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val surfaceView = SurfaceView(context)
    private val pictureListener: (PictureState) -> Unit = { state -> keepScreenOn = state.awake }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        PictureSlot.addListener(pictureListener)
    }

    override fun onDetachedFromWindow() {
        PictureSlot.removeListener(pictureListener)
        keepScreenOn = false
        super.onDetachedFromWindow()
    }

    init {
        surfaceView.holder.addCallback(
            object : SurfaceHolder.Callback {
                override fun surfaceCreated(holder: SurfaceHolder) {
                    VideoSurfaceSlot.offer(holder.surface)
                }

                override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

                override fun surfaceDestroyed(holder: SurfaceHolder) {
                    VideoSurfaceSlot.withdraw(holder.surface)
                }
            },
        )
        addView(surfaceView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
}
