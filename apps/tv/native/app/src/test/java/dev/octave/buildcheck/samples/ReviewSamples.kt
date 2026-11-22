package dev.octave.buildcheck.samples

import java.net.URL as Net

// Compiled samples for NetworkPathsReviewTest (the T3-04 review's findings). Like NetworkPathSamples.kt, they sit
// under /src/test/, which the source check skips.

// K5: an aliased URL read with the standard library's readText(), which opens the stream inside the library.
class ReadsAUrlAsText {
    fun read(address: String) = Net(address).readText()
}

// K4: Android's own player, which fetches a URL without the header.
class PlaysThroughMediaPlayer {
    fun play(address: String) = android.media.MediaPlayer().apply { setDataSource(address) }
}

// K4: a VideoView, which plays a URL through MediaPlayer.
class PlaysThroughVideoView {
    fun play(view: android.widget.VideoView, address: String) = view.setVideoPath(address)
}
