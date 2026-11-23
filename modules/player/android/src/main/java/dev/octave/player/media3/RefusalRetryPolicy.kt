package dev.octave.player.media3

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import dev.octave.session.http.OctaveHttpException

// D8 (docs/specs/T8-02.md): a load the one client refused (a redirect, an ended session, another origin) is not
// retried, so it fails at once and the server is not asked again. Every other load error keeps Media3's policy.
@OptIn(UnstableApi::class)
internal object RefusalRetryPolicy : DefaultLoadErrorHandlingPolicy() {
    override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long =
        if (causes(loadErrorInfo.exception).any { it is OctaveHttpException }) C.TIME_UNSET else super.getRetryDelayMsFor(loadErrorInfo)
}

// A throwable and its causes, outermost first, at most 16 deep so a cycle cannot hang the player's thread.
internal fun causes(error: Throwable?): List<Throwable> = generateSequence(error) { it.cause }.take(16).toList()
