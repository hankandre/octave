package dev.octave.buildcheck

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// The core's shared test vectors are readable from the test JVM by the path T3-03 and T8-08 will use.
class SharedVectorsTest {
    private fun assertVectors(name: String) {
        val file = BuildCheck.repoRoot.resolve("packages/core/tests/fixtures/$name")
        assertTrue(file.isFile, "${file.path} is a file")
        val text = file.readText().trim()
        assertTrue(text.startsWith("{") || text.startsWith("["), "$name holds JSON")
        assertTrue(text.length > 2, "$name is not empty")
    }

    @Test
    fun hostClassesAreReadable() = assertVectors("host-classes.json")

    @Test
    fun hlsMasterUrlsAreReadable() = assertVectors("hls-master-urls.json")

    @Test
    fun hlsPlaylistsAreReadable() = assertVectors("hls-playlists.json")
}
