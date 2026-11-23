package dev.octave.player.media3

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.util.Log
import androidx.media3.common.util.UnstableApi
import dev.octave.player.VideoSurfaceSlot
import dev.octave.player.engine.CapabilityProbe
import dev.octave.player.engine.EngineCore
import dev.octave.player.engine.MainThreadGate
import dev.octave.player.seam.Capabilities
import dev.octave.player.seam.LaunchRequest
import dev.octave.player.seam.PlaybackEngine
import dev.octave.player.seam.PlayerEngineException
import dev.octave.player.seam.PlayerErrorCode
import dev.octave.player.seam.PlayerEvent
import dev.octave.player.seam.TrackType

// The Android engine behind the seam (T8-02): EngineCore's rules over one Media3Handle per launch. The capability
// probe (T8-07) reads the device afresh on every initialize, on the module's command thread; HLS stays unsupported
// until T8-08.
//
// Threading (docs/specs/T8-02.md, "Threading"): the players and EngineCore live on the main looper. MainThreadGate
// runs each method inline when called on the main looper, and otherwise posts it to the main thread and waits at most
// 10 s, so CommandQueue's thread waits and a main-thread caller (the module's OnDestroy) neither blocks nor times out.
// Once `closed()` holds (the module was destroyed), every call but stop is refused when it comes to run, and a launch
// whose caller stopped waiting is stopped when it finishes late. The surface listener runs on the UI thread, which is
// the main thread, and never waits. The engine logs nothing, and Media3's own logging is off before the first player
// (D12).
@OptIn(UnstableApi::class)
class Media3Engine(private val context: () -> Context?, private val closed: () -> Boolean) : PlaybackEngine {
    private val main = Handler(Looper.getMainLooper())
    private val gate = MainThreadGate(
        onMainThread = { Looper.myLooper() == Looper.getMainLooper() },
        post = { work -> main.post(work) },
        closed = closed,
        waitMillis = MAIN_WAIT_MILLIS,
    )

    @Volatile
    private var listener: ((PlayerEvent) -> Unit)? = null

    private val core: EngineCore = EngineCore(::newHandle) { event -> listener?.invoke(event) }
    private var holdsSurface = false
    private var logsOff = false

    private val probe = CapabilityProbe { DevicePlatformReader.read(if (closed()) null else context()) }

    override fun capabilities(): Capabilities = probe.probe()

    override fun setListener(listener: ((PlayerEvent) -> Unit)?) {
        this.listener = listener
    }

    override fun launch(request: LaunchRequest) = gate.run(undoLate = ::release) {
        if (request !is LaunchRequest.Original) throw PlayerEngineException(PlayerErrorCode.UNSUPPORTED_REQUEST)
        if (context() == null) throw PlayerEngineException(PlayerErrorCode.UNSUPPORTED_REQUEST)
        if (!logsOff) {
            Log.setLogLevel(Log.LOG_LEVEL_OFF)
            logsOff = true
        }
        if (!holdsSurface) {
            VideoSurfaceSlot.setListener { surface -> core.surface(surface) }
            holdsSurface = true
        }
        core.launch(request)
    }

    override fun setPaused(paused: Boolean) = gate.run { core.setPaused(paused) }

    override fun seek(positionSeconds: Double) = gate.run { core.seek(positionSeconds) }

    override fun selectTrack(type: TrackType, playerId: Int?) = gate.run { core.selectTrack(type, playerId) }

    override fun stop() = gate.runEvenWhenClosed(::release)

    private fun release() {
        core.stop()
        if (holdsSurface) {
            VideoSurfaceSlot.setListener(null)
            holdsSurface = false
        }
    }

    // A handle's signals reach the core only while it is the current launch's (E3a).
    private fun newHandle(request: LaunchRequest.Original): Media3Handle {
        val appContext = context() ?: throw PlayerEngineException(PlayerErrorCode.UNSUPPORTED_REQUEST)
        return Media3Handle(appContext, request.session) { handle, signal -> if (core.isCurrent(handle)) core.signal(signal) }
    }

    private companion object {
        const val MAIN_WAIT_MILLIS = 10_000L
    }
}
