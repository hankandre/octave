package dev.octave.buildcheck

import dev.octave.buildcheck.samples.PlaysThroughMediaPlayer
import dev.octave.buildcheck.samples.PlaysThroughVideoView
import dev.octave.buildcheck.samples.ReadsAUrlAsText
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// The T3-04 review's findings by type: a URL opened inside the standard library, and players and image loaders that
// fetch without the header. NetworkPathsBytecodeTest holds the task's own samples.
class NetworkPathsReviewTest {
    private fun violationsOf(type: Class<*>): List<NetworkViolation> {
        val resource = type.name.replace('.', '/') + ".class"
        val bytes = checkNotNull(checkNotNull(type.classLoader).getResourceAsStream(resource)) { "cannot read $resource" }.use { it.readBytes() }
        return NetworkPathRules.check(ClassReferences.read(bytes))
    }

    private fun probe(vararg members: MemberRef, utf8: Set<String> = emptySet()): ClassRefs =
        ClassRefs("dev/octave/tv/Probe", members.map { it.owner }.toSet(), members.toList(), members.flatMap { listOf(it.owner, it.name, it.descriptor) }.toSet() + utf8)

    private fun rules(refs: ClassRefs) = NetworkPathRules.check(refs).map { it.rule }.toSet()

    @Test
    fun an_aliased_url_read_as_text_is_caught() {
        val found = violationsOf(ReadsAUrlAsText::class.java)
        assertTrue(found.any { it.rule == "K5" && it.what == "java/net/URL.<init>" }, "$found")
        assertTrue(found.any { it.rule == "K5" && it.what.contains("which takes a java.net.URL") }, "$found")
    }

    @Test
    fun a_url_constructor_or_a_member_that_takes_a_url_fails_k5() {
        assertEquals(setOf("K5"), rules(probe(MemberRef("java/net/URL", "<init>", "(Ljava/lang/String;)V"))))
        assertEquals(setOf("K5"), rules(probe(MemberRef("kotlin/io/TextStreamsKt", "readBytes", "(Ljava/net/URL;)[B"))))
        // A URL as a return type, or a URL method that opens nothing, passes.
        assertEquals(emptySet<String>(), rules(probe(MemberRef("okhttp3/HttpUrl", "url", "()Ljava/net/URL;"))))
        assertEquals(emptySet<String>(), rules(probe(MemberRef("java/net/URLEncoder", "encode", "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;"))))
    }

    @Test
    fun players_and_image_loaders_fail_k4() {
        assertTrue(violationsOf(PlaysThroughMediaPlayer::class.java).any { it.rule == "K4" })
        assertTrue(violationsOf(PlaysThroughVideoView::class.java).any { it.rule == "K4" })
        for (owner in listOf("coil/ImageLoader", "coil3/ImageLoader", "com/bumptech/glide/Glide", "com/squareup/picasso/Picasso", "org/chromium/net/CronetEngine", "com/android/volley/RequestQueue", "java/net/http/HttpClient")) {
            assertEquals(setOf("K4"), rules(probe(MemberRef(owner, "get", "()V"))), owner)
        }
        // Coil's extension, named only in a descriptor, and a reflective name in a string.
        assertEquals(setOf("K4"), rules(probe(MemberRef("dev/octave/image/Loads", "load", "(Landroid/widget/ImageView;Lcoil/request/ImageRequest;)V"))))
        assertEquals(setOf("K4"), rules(probe(utf8 = setOf("com.bumptech.glide.Glide"))))
        // A class whose name only holds a banned word passes.
        assertEquals(emptySet<String>(), rules(probe(MemberRef("dev/octave/tv/coilSpring", "get", "()V"))))
    }
}
