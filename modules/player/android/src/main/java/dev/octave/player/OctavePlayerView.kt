package dev.octave.player

import android.content.Context
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// The view that hosts the video (T8-01, item 5): one SurfaceView filling it. It takes no prop, event or function from
// React; it hands its surface to VideoSurfaceSlot natively, where an engine (T8-02) picks it up.
class OctavePlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val surfaceView = SurfaceView(context)

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
