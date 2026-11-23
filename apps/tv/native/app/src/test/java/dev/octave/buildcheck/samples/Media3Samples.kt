package dev.octave.buildcheck.samples

import android.content.Context
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.UdpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.RenderersFactory
import androidx.media3.exoplayer.analytics.AnalyticsCollector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.trackselection.TrackSelector
import androidx.media3.exoplayer.upstream.BandwidthMeter
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.text.SubtitleParser
import okhttp3.Call

// T8-02 item 9 (docs/specs/T8-02.md, "Build fences"): compiled calls of Media3 1.11.1, read by NetworkPathsBytecodeTest
// in place of the descriptors T3-04 wrote by hand. Each class is one sample; its name says what it does and the test
// says which rule it must fail or pass. Nothing here runs: the classes are only read.

// ExoPlayer.Builder's five constructors. The two without a MediaSource.Factory build Media3's default one (K6) unless
// setMediaSourceFactory follows.
class BuildsAPlayerWithDefaults {
    fun build(context: Context) = ExoPlayer.Builder(context)
}

class BuildsAPlayerWithRenderers {
    fun build(context: Context, renderers: RenderersFactory) = ExoPlayer.Builder(context, renderers)
}

class BuildsAPlayerThenStatesItsSources {
    fun build(context: Context, sources: MediaSource.Factory) = ExoPlayer.Builder(context).setMediaSourceFactory(sources)
}

class BuildsAPlayerWithRenderersThenStatesItsSources {
    fun build(context: Context, renderers: RenderersFactory, sources: MediaSource.Factory) = ExoPlayer.Builder(context, renderers).setMediaSourceFactory(sources)
}

class BuildsAPlayerWithSources {
    fun build(context: Context, sources: MediaSource.Factory) = ExoPlayer.Builder(context, sources)
}

class BuildsAPlayerWithRenderersAndSources {
    fun build(context: Context, renderers: RenderersFactory, sources: MediaSource.Factory) = ExoPlayer.Builder(context, renderers, sources)
}

class BuildsAPlayerWithEverything {
    fun build(
        context: Context,
        renderers: RenderersFactory,
        sources: MediaSource.Factory,
        tracks: TrackSelector,
        load: LoadControl,
        bandwidth: BandwidthMeter,
        analytics: AnalyticsCollector,
    ) = ExoPlayer.Builder(context, renderers, sources, tracks, load, bandwidth, analytics)
}

// DefaultMediaSourceFactory's five constructors. The two Context ones build Media3's default data source (K3) unless
// setDataSourceFactory follows.
class BuildsDefaultSources {
    fun build(context: Context) = DefaultMediaSourceFactory(context)
}

class BuildsDefaultSourcesWithExtractors {
    fun build(context: Context, extractors: ExtractorsFactory) = DefaultMediaSourceFactory(context, extractors)
}

class BuildsDefaultSourcesThenStatesTheDataSource {
    fun build(context: Context, data: DataSource.Factory) = DefaultMediaSourceFactory(context).setDataSourceFactory(data)
}

class BuildsDefaultSourcesOverADataSource {
    fun build(data: DataSource.Factory) = DefaultMediaSourceFactory(data)
}

class BuildsDefaultSourcesOverADataSourceWithExtractors {
    fun build(data: DataSource.Factory, extractors: ExtractorsFactory) = DefaultMediaSourceFactory(data, extractors)
}

class BuildsDefaultSourcesOverADataSourceWithSubtitles {
    fun build(data: DataSource.Factory, extractors: ExtractorsFactory, subtitles: SubtitleParser.Factory) =
        DefaultMediaSourceFactory(data, extractors, subtitles)
}

// Media3's own network paths: the default HTTP and default data sources and UDP (K1, K2).
class BuildsTheDefaultHttpDataSource {
    fun build() = DefaultHttpDataSource.Factory()
}

class BuildsTheDefaultDataSource {
    fun build(context: Context) = DefaultDataSource.Factory(context)
}

class OpensUdp {
    fun build() = UdpDataSource()
}

// Media3's OkHttp data source over a call factory, from outside dev.octave.player.media3: K7 refuses it here (the
// Product Owner ruling of 2026-11-23 allows that one constructor only from the engine's package).
class BuildsTheOkHttpDataSourceOutsideTheEngine {
    fun build(calls: Call.Factory): DataSource.Factory = OkHttpDataSource.Factory(calls)
}
