package dev.octave.player.media3

import android.content.Context
import android.os.Build
import android.os.Looper
import android.view.Surface
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import dev.octave.player.engine.EngineSignal
import dev.octave.player.engine.HandleFacts
import dev.octave.player.engine.PlayerHandle
import dev.octave.session.http.OctaveHttp
import dev.octave.session.http.SessionId

// One ExoPlayer for one launch (docs/specs/T8-02.md, "The engine's build", D2, D3). Its only media source factory is
// Octave's: ProgressiveMediaSource over Media3's OkHttp data source on the one client's call factory for the
// launch's session, with nothing set on the data source, so every media byte takes the one client's origin, redirect,
// proxy and cookie policy. Its video output is only the surface VideoSurfaceSlot hands over. It runs on the main
// looper and turns ExoPlayer's callbacks into EngineSignals; no player text, URL or path leaves it.
@OptIn(UnstableApi::class)
internal class Media3Handle(
    context: Context,
    session: SessionId,
    private val signal: (Media3Handle, EngineSignal) -> Unit,
) : PlayerHandle, Player.Listener, AnalyticsListener {
    private val player: ExoPlayer

    init {
        val dataSources: DataSource.Factory = OkHttpDataSource.Factory(OctaveHttp.callFactory(session))
        val mediaSources = ProgressiveMediaSource.Factory(dataSources).setLoadErrorHandlingPolicy(RefusalRetryPolicy)
        player = ExoPlayer.Builder(context, DefaultRenderersFactory(context), mediaSources)
            .setMediaSourceFactory(mediaSources)
            .setLooper(Looper.getMainLooper())
            .build()
        player.addListener(this)
        player.addAnalyticsListener(this)
    }

    override fun prepare(url: String, startPositionMs: Long) {
        player.setMediaItem(MediaItem.fromUri(url), startPositionMs)
        player.prepare()
    }

    override fun setPlayWhenReady(play: Boolean) {
        player.playWhenReady = play
    }

    override fun seekTo(positionMs: Long) = player.seekTo(positionMs)

    override fun setSurface(surface: Any?) = player.setVideoSurface(surface as? Surface)

    override fun stop() = player.stop()

    override fun release() {
        player.removeListener(this)
        player.removeAnalyticsListener(this)
        player.release()
    }

    override fun facts(): HandleFacts {
        val size = player.videoSize
        return HandleFacts(
            positionMs = player.currentPosition,
            durationMs = player.duration.takeIf { it != C.TIME_UNSET },
            playWhenReady = player.playWhenReady,
            buffering = player.playbackState == Player.STATE_BUFFERING,
            droppedFrames = player.videoDecoderCounters?.droppedBufferCount ?: 0,
            width = size.width.takeIf { it > 0 },
            height = size.height.takeIf { it > 0 },
        )
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        when (playbackState) {
            Player.STATE_BUFFERING -> signal(this, EngineSignal.Buffering)
            Player.STATE_READY -> signal(this, EngineSignal.Ready)
            Player.STATE_ENDED -> signal(this, EngineSignal.Ended)
        }
    }

    override fun onRenderedFirstFrame() = signal(this, EngineSignal.FirstFrameRendered)

    override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
        if (reason == Player.DISCONTINUITY_REASON_SEEK) signal(this, EngineSignal.SeekProcessed)
    }

    // E6 reads whether a decoder takes each type, allowing a track that exceeds what the decoder reports (D5).
    override fun onTracksChanged(tracks: Tracks) {
        signal(
            this,
            EngineSignal.TracksKnown(
                videoPresent = tracks.containsType(C.TRACK_TYPE_VIDEO),
                videoSupported = tracks.isTypeSupported(C.TRACK_TYPE_VIDEO, true),
                audioPresent = tracks.containsType(C.TRACK_TYPE_AUDIO),
                audioSupported = tracks.isTypeSupported(C.TRACK_TYPE_AUDIO, true),
            ),
        )
    }

    override fun onPlayerError(error: PlaybackException) = signal(this, EngineSignal.Failed(error.errorCode, causes(error.cause)))

    // The decoder's flags are Media3's entry for that name under the video's type or the type Media3 may decode it as
    // instead (a Dolby Vision track on an HEVC decoder); none when Media3 lists no such name. ExoPlayer reports the
    // decoder before the input format that made it, so the facts go out once both are known.
    private var decoderName: String? = null
    private var videoFormat: Format? = null

    override fun onVideoDecoderInitialized(
        eventTime: AnalyticsListener.EventTime,
        decoderName: String,
        initializedTimestampMs: Long,
        initializationDurationMs: Long,
    ) {
        this.decoderName = decoderName
        reportDecoder()
    }

    override fun onVideoInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
        val type = format.sampleMimeType ?: return
        if (type == videoFormat?.sampleMimeType) return
        videoFormat = format
        reportDecoder()
    }

    private fun reportDecoder() {
        val name = decoderName ?: return
        val format = videoFormat ?: return
        decoderName = null
        val types = listOfNotNull(format.sampleMimeType, MediaCodecUtil.getAlternativeCodecMimeType(format)).distinct()
        val info = types.firstNotNullOfOrNull { type ->
            try {
                MediaCodecUtil.getDecoderInfos(type, false, false).firstOrNull { it.name == name }
            } catch (_: MediaCodecUtil.DecoderQueryException) {
                null
            }
        }
        signal(this, EngineSignal.DecoderInitialized(name, info?.hardwareAccelerated, info?.softwareOnly, Build.VERSION.SDK_INT))
    }
}
