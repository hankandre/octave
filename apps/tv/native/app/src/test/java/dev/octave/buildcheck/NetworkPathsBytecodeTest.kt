package dev.octave.buildcheck

import dev.octave.buildcheck.samples.AddsANetworkInterceptor
import dev.octave.buildcheck.samples.BuildsAClient
import dev.octave.buildcheck.samples.CallsADefault
import dev.octave.buildcheck.samples.DerivesAClient
import dev.octave.buildcheck.samples.OpensAUrl
import dev.octave.buildcheck.samples.ReadsAUrl
import dev.octave.buildcheck.samples.SendsThroughACallFactory
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.net.JarURLConnection
import java.util.jar.JarFile

// T3-04 items 1 and 2 by type (docs/specs/T3-04.md, "The JVM test"): Octave's compiled classes refer to no other HTTP
// client, no default Media3 path and no client hook, which a text scan cannot see when a type is inferred or a
// mangled `internal` member is read from another module. pnpm lint:network applies the same rules to the source.
class NetworkPathsBytecodeTest {
    private fun bytesOf(type: Class<*>): ByteArray {
        val resource = type.name.replace('.', '/') + ".class"
        return checkNotNull(checkNotNull(type.classLoader).getResourceAsStream(resource)) { "cannot read $resource" }.use { it.readBytes() }
    }

    private fun violationsOf(type: Class<*>) = NetworkPathRules.check(ClassReferences.read(bytesOf(type)))

    private fun assertCaught(rule: String, type: Class<*>) {
        val found = violationsOf(type)
        assertTrue(found.any { it.rule == rule }, "$rule on ${type.name}: $found")
    }

    @Test
    fun compiled_samples_are_caught_by_type() {
        assertCaught("K4", BuildsAClient::class.java)
        assertCaught("K4", DerivesAClient::class.java)
        assertCaught("K5", OpensAUrl::class.java)
        assertCaught("K5", ReadsAUrl::class.java)
        assertCaught("K8", AddsANetworkInterceptor::class.java)
        assertEquals(emptyList<NetworkViolation>(), violationsOf(SendsThroughACallFactory::class.java))
        assertEquals(emptyList<NetworkViolation>(), violationsOf(CallsADefault::class.java))
    }

    @Test
    fun media3_rules_by_descriptor() {
        val context = "Landroid/content/Context;"
        val renderers = "Landroidx/media3/exoplayer/RenderersFactory;"
        val dataSources = "Landroidx/media3/datasource/DataSource\$Factory;"
        val mediaSources = "Landroidx/media3/exoplayer/source/MediaSource\$Factory;"
        val extractors = "Landroidx/media3/extractor/ExtractorsFactory;"
        val subtitles = "Landroidx/media3/extractor/text/SubtitleParser\$Factory;"
        val factory = "androidx/media3/exoplayer/source/DefaultMediaSourceFactory"
        val builder = "androidx/media3/exoplayer/ExoPlayer\$Builder"

        // DefaultMediaSourceFactory's five constructors (Media3 1.11.1): the two Context ones build Media3's default
        // data source unless setDataSourceFactory follows.
        for (descriptor in listOf("($context)V", "($context$extractors)V")) {
            assertRules(setOf("K3"), probe(MemberRef(factory, "<init>", descriptor)))
            assertRules(emptySet(), probe(MemberRef(factory, "<init>", descriptor), MemberRef(factory, "setDataSourceFactory", "($dataSources)L$factory;")))
        }
        for (descriptor in listOf("($dataSources)V", "($dataSources$extractors)V", "($dataSources$extractors$subtitles)V")) {
            assertRules(emptySet(), probe(MemberRef(factory, "<init>", descriptor)))
        }

        // ExoPlayer.Builder's constructors: the ones without a MediaSource.Factory build the default one unless
        // setMediaSourceFactory follows.
        for (descriptor in listOf("($context)V", "($context$renderers)V")) {
            assertRules(setOf("K6"), probe(MemberRef(builder, "<init>", descriptor)))
            assertRules(emptySet(), probe(MemberRef(builder, "<init>", descriptor), MemberRef(builder, "setMediaSourceFactory", "($mediaSources)L$builder;")))
        }
        for (descriptor in listOf("($context$mediaSources)V", "($context$renderers$mediaSources)V")) {
            assertRules(emptySet(), probe(MemberRef(builder, "<init>", descriptor)))
        }

        // The default data sources and the paths that are not HTTP, by class name.
        assertRules(setOf("K1"), probe(MemberRef("androidx/media3/datasource/DefaultHttpDataSource\$Factory", "<init>", "()V")))
        assertRules(setOf("K1"), probe(MemberRef("androidx/media3/datasource/HttpEngineDataSource\$Factory", "<init>", "()V")))
        assertRules(setOf("K1"), probe(MemberRef("androidx/media3/datasource/UdpDataSource", "<init>", "()V")))
        assertRules(setOf("K1"), probe(MemberRef("androidx/media3/exoplayer/rtsp/RtspMediaSource\$Factory", "<init>", "()V")))
        assertRules(setOf("K1"), probe(MemberRef("androidx/media3/datasource/rtmp/RtmpDataSource\$Factory", "<init>", "()V")))
        assertRules(setOf("K2"), probe(MemberRef("androidx/media3/datasource/DefaultDataSource\$Factory", "<init>", "($context)V")))
        assertRules(setOf("K2"), probe(MemberRef("androidx/media3/datasource/DefaultDataSourceFactory", "<init>", "($context)V")))
        assertRules(emptySet(), probe(MemberRef("androidx/media3/datasource/okhttp/OkHttpDataSource\$Factory", "<init>", "(Lokhttp3/Call\$Factory;)V")))
    }

    @Test
    fun every_rule_has_a_failing_and_a_passing_sample() {
        val samples: Map<String, Pair<ClassRefs, ClassRefs>> = mapOf(
            "K1" to (probe(MemberRef("androidx/media3/datasource/DefaultHttpDataSource\$Factory", "<init>", "()V")) to
                probe(MemberRef("androidx/media3/datasource/okhttp/OkHttpDataSource\$Factory", "<init>", "(Lokhttp3/Call\$Factory;)V"))),
            "K2" to (probe(MemberRef("androidx/media3/datasource/DefaultDataSource\$Factory", "<init>", "(Landroid/content/Context;)V")) to
                probe(MemberRef("dev/octave/session/http/OctaveHttp", "callFactory", "(Ljava/lang/String;)Lokhttp3/Call\$Factory;"))),
            "K3" to (probe(MemberRef("androidx/media3/exoplayer/source/DefaultMediaSourceFactory", "<init>", "(Landroid/content/Context;)V")) to
                probe(MemberRef("androidx/media3/exoplayer/source/DefaultMediaSourceFactory", "<init>", "(Landroidx/media3/datasource/DataSource\$Factory;)V"))),
            "K4" to (probe(MemberRef("okhttp3/OkHttpClient", "<init>", "()V")) to
                probe(MemberRef("okhttp3/Call\$Factory", "newCall", "(Lokhttp3/Request;)Lokhttp3/Call;"))),
            "K5" to (probe(MemberRef("java/net/URL", "openConnection", "()Ljava/net/URLConnection;")) to
                probe(MemberRef("java/net/URLEncoder", "encode", "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;"))),
            "K6" to (probe(MemberRef("androidx/media3/exoplayer/ExoPlayer\$Builder", "<init>", "(Landroid/content/Context;)V")) to
                probe(MemberRef("androidx/media3/exoplayer/ExoPlayer\$Builder", "<init>", "(Landroid/content/Context;Landroidx/media3/exoplayer/source/MediaSource\$Factory;)V"))),
            "K7" to (probe(MemberRef("com/facebook/react/modules/network/OkHttpClientProvider", "setOkHttpClientFactory", "(Lcom/facebook/react/modules/network/OkHttpClientFactory;)V")) to
                probe(MemberRef("expo/modules/kotlin/modules/Module", "<init>", "()V"))),
            "K8" to (probe(MemberRef("expo/modules/kotlin/devtools/ExpoNetworkInspectOkHttpNetworkInterceptor", "<init>", "()V")) to
                probe(MemberRef("okhttp3/Interceptor\$Chain", "proceed", "(Lokhttp3/Request;)Lokhttp3/Response;"))),
            "K9" to (probe(MemberRef("android/webkit/WebView", "<init>", "(Landroid/content/Context;)V")) to
                probe(MemberRef("android/widget/TextView", "<init>", "(Landroid/content/Context;)V"))),
            "K10" to (probe(MemberRef("dev/octave/session/http/OctaveHttp", "getClient\$octave_session_debug", "()Lokhttp3/Call\$Factory;")) to
                probe(MemberRef("dev/octave/session/http/MediaBrowserHeader", "build\$default", "()Ljava/lang/String;"))),
        )
        assertEquals(NetworkPathRules.RULE_IDS.toSet(), samples.keys)
        for ((rule, sample) in samples) {
            val (failing, passing) = sample
            assertTrue(NetworkPathRules.check(failing).any { it.rule == rule }, "$rule failing sample: ${NetworkPathRules.check(failing)}")
            assertEquals(emptyList<NetworkViolation>(), NetworkPathRules.check(passing), "$rule passing sample")
        }
        // The one client's own classes may name it; nothing else may.
        val client = MemberRef("okhttp3/OkHttpClient\$Builder", "<init>", "()V")
        assertRules(emptySet(), probe(client, name = "dev/octave/session/http/OctaveHttp"))
        assertRules(setOf("K4"), probe(client, name = "dev/octave/session/http/OtherClient"))
        // A reflective name in a string is read as a class name.
        assertRules(setOf("K4"), ClassRefs("dev/octave/tv/Probe", emptySet(), emptyList(), setOf("okhttp3.OkHttpClient")))
    }

    @Test
    fun octave_classes_reference_no_other_client() {
        val classes = octaveClasses()
        println("NetworkPathsBytecodeTest read ${classes.size} Octave classes")
        assertTrue("dev/octave/session/http/OctaveHttp" in classes, "did not read OctaveHttp.class; read ${classes.keys.sorted()}")
        assertTrue("dev/octave/tv/MainApplication" in classes, "did not read MainApplication.class; read ${classes.keys.sorted()}")
        val found = classes.values.flatMap { NetworkPathRules.check(ClassReferences.read(it)) }
        assertEquals(emptyList<NetworkViolation>(), found)
    }

    // --- helpers ---

    private fun probe(vararg members: MemberRef, name: String = "dev/octave/tv/Probe"): ClassRefs {
        val utf8 = members.flatMap { listOf(it.owner, it.name, it.descriptor) }.toSet()
        return ClassRefs(name, members.map { it.owner }.toSet(), members.toList(), utf8)
    }

    private fun assertRules(expected: Set<String>, refs: ClassRefs) {
        val found = NetworkPathRules.check(refs)
        assertEquals(expected, found.map { it.rule }.toSet(), "$refs: $found")
    }

    // Every class file under dev/octave/ on the test runtime classpath but this test's own package, by internal name.
    private fun octaveClasses(): Map<String, ByteArray> {
        val classes = sortedMapOf<String, ByteArray>()
        fun add(name: String, bytes: () -> ByteArray) {
            if (name.startsWith("dev/octave/") && !name.startsWith("dev/octave/buildcheck/") && name.endsWith(".class")) {
                classes.putIfAbsent(name.removeSuffix(".class"), bytes())
            }
        }
        fun readRoot(root: File) {
            if (root.isDirectory) {
                root.walkTopDown().filter { it.isFile }.forEach { file -> add(file.relativeTo(root).invariantSeparatorsPath) { file.readBytes() } }
            } else if (root.isFile && root.name.endsWith(".jar")) {
                JarFile(root).use { jar ->
                    for (entry in jar.entries()) add(entry.name) { jar.getInputStream(entry).use { it.readBytes() } }
                }
            }
        }
        val roots = linkedSetOf<File>()
        System.getProperty("java.class.path").orEmpty().split(File.pathSeparator).filter { it.isNotEmpty() }.forEach { roots += File(it) }
        val loader = checkNotNull(javaClass.classLoader)
        for (url in loader.getResources("dev/octave").toList()) {
            when (url.protocol) {
                "file" -> roots += checkNotNull(File(url.toURI()).parentFile?.parentFile)
                "jar" -> roots += File((url.openConnection() as JarURLConnection).jarFileURL.toURI())
            }
        }
        roots.forEach(::readRoot)
        return classes
    }
}
