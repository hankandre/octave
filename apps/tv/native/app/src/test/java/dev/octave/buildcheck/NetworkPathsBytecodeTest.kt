package dev.octave.buildcheck

import androidx.media3.common.MediaLibraryInfo
import dev.octave.buildcheck.samples.AddsANetworkInterceptor
import dev.octave.buildcheck.samples.BuildsAClient
import dev.octave.buildcheck.samples.BuildsAPlayerThenStatesItsSources
import dev.octave.buildcheck.samples.BuildsAPlayerWithDefaults
import dev.octave.buildcheck.samples.BuildsAPlayerWithEverything
import dev.octave.buildcheck.samples.BuildsAPlayerWithRenderers
import dev.octave.buildcheck.samples.BuildsAPlayerWithRenderersAndSources
import dev.octave.buildcheck.samples.BuildsAPlayerWithRenderersThenStatesItsSources
import dev.octave.buildcheck.samples.BuildsAPlayerWithSources
import dev.octave.buildcheck.samples.BuildsDefaultSources
import dev.octave.buildcheck.samples.BuildsDefaultSourcesOverADataSource
import dev.octave.buildcheck.samples.BuildsDefaultSourcesOverADataSourceWithExtractors
import dev.octave.buildcheck.samples.BuildsDefaultSourcesOverADataSourceWithSubtitles
import dev.octave.buildcheck.samples.BuildsDefaultSourcesThenStatesTheDataSource
import dev.octave.buildcheck.samples.BuildsDefaultSourcesWithExtractors
import dev.octave.buildcheck.samples.BuildsTheDefaultDataSource
import dev.octave.buildcheck.samples.BuildsTheDefaultHttpDataSource
import dev.octave.buildcheck.samples.BuildsTheOkHttpDataSourceOutsideTheEngine
import dev.octave.buildcheck.samples.CallsADefault
import dev.octave.buildcheck.samples.DerivesAClient
import dev.octave.buildcheck.samples.OpensUdp
import dev.octave.buildcheck.samples.OpensAUrl
import dev.octave.buildcheck.samples.ReadsAUrl
import dev.octave.buildcheck.samples.SendsThroughACallFactory
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.net.JarURLConnection
import java.util.concurrent.TimeUnit
import java.util.jar.JarFile

// T3-04 items 1 and 2 by type (docs/specs/T3-04.md, "The JVM test"): Octave's compiled classes refer to no other HTTP
// client, no default Media3 path and no client hook, which a text scan cannot see when a type is inferred or a
// mangled `internal` member is read from another module. pnpm lint:network applies the same rules to the source.
class NetworkPathsBytecodeTest {
    private fun bytesOf(type: Class<*>): ByteArray {
        val resource = type.name.replace('.', '/') + ".class"
        return checkNotNull(checkNotNull(type.classLoader).getResourceAsStream(resource)) { "cannot read $resource" }.use { it.readBytes() }
    }

    private fun compiled(type: Class<*>) = ClassReferences.read(bytesOf(type))

    private fun violationsOf(type: Class<*>) = NetworkPathRules.check(compiled(type))

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

    // T8-02 item 9: Media3's constructors and default paths as compiled calls (samples/Media3Samples.kt, Media3 at the
    // player's pin), read the way octave_classes_reference_no_other_client reads Octave's classes.
    @Test
    fun media3_rules_by_descriptor() {
        // ExoPlayer.Builder: the constructors without a MediaSource.Factory build the default one unless
        // setMediaSourceFactory follows.
        assertRules(setOf("K6"), compiled(BuildsAPlayerWithDefaults::class.java))
        assertRules(setOf("K6"), compiled(BuildsAPlayerWithRenderers::class.java))
        assertRules(emptySet(), compiled(BuildsAPlayerThenStatesItsSources::class.java))
        assertRules(emptySet(), compiled(BuildsAPlayerWithRenderersThenStatesItsSources::class.java))
        assertRules(emptySet(), compiled(BuildsAPlayerWithSources::class.java))
        assertRules(emptySet(), compiled(BuildsAPlayerWithRenderersAndSources::class.java))
        assertRules(emptySet(), compiled(BuildsAPlayerWithEverything::class.java))

        // DefaultMediaSourceFactory: the two Context constructors build Media3's default data source unless
        // setDataSourceFactory follows.
        assertRules(setOf("K3"), compiled(BuildsDefaultSources::class.java))
        assertRules(setOf("K3"), compiled(BuildsDefaultSourcesWithExtractors::class.java))
        assertRules(emptySet(), compiled(BuildsDefaultSourcesThenStatesTheDataSource::class.java))
        assertRules(emptySet(), compiled(BuildsDefaultSourcesOverADataSource::class.java))
        assertRules(emptySet(), compiled(BuildsDefaultSourcesOverADataSourceWithExtractors::class.java))
        assertRules(emptySet(), compiled(BuildsDefaultSourcesOverADataSourceWithSubtitles::class.java))

        // The default data sources and UDP, compiled; the paths whose artifacts Octave does not adopt, by name.
        assertRules(setOf("K1"), compiled(BuildsTheDefaultHttpDataSource::class.java))
        assertRules(setOf("K2"), compiled(BuildsTheDefaultDataSource::class.java))
        assertRules(setOf("K1"), compiled(OpensUdp::class.java))
        assertRules(setOf("K1"), probe(MemberRef("androidx/media3/datasource/HttpEngineDataSource\$Factory", "<init>", "()V")))
        assertRules(setOf("K1"), probe(MemberRef(RTSP_FACTORY, "<init>", "()V")))
        assertRules(setOf("K1"), probe(MemberRef(RTMP_FACTORY, "<init>", "()V")))
        assertRules(setOf("K2"), probe(MemberRef("androidx/media3/datasource/DefaultDataSourceFactory", "<init>", "(Landroid/content/Context;)V")))

        // Media3's OkHttp data source: K7 refuses it outside the engine's package (Product Owner ruling of 2026-11-23).
        assertRules(setOf("K7"), compiled(BuildsTheOkHttpDataSourceOutsideTheEngine::class.java))
        val okHttpFactory = MemberRef("androidx/media3/datasource/okhttp/OkHttpDataSource\$Factory", "<init>", "(Lokhttp3/Call\$Factory;)V")
        assertRules(emptySet(), probe(okHttpFactory, name = "dev/octave/player/media3/Probe"))
        assertRules(setOf("K7"), probe(okHttpFactory))
    }

    // The RTSP and RTMP names are probes, not compiled calls, since their artifacts are not adopted; they were re-read
    // in Media3's source at MEDIA3_NAMES_READ_AT, and this fails at a Media3 upgrade until they are read again.
    @Test
    fun media3_names_were_read_at_the_adopted_version() {
        assertEquals(MEDIA3_NAMES_READ_AT, MediaLibraryInfo.VERSION, "re-read the RTSP and RTMP names, then move MEDIA3_NAMES_READ_AT")
    }

    @Test
    fun every_rule_has_a_failing_and_a_passing_sample() {
        val samples: Map<String, Pair<ClassRefs, ClassRefs>> = mapOf(
            "K1" to (compiled(BuildsTheDefaultHttpDataSource::class.java) to compiled(BuildsDefaultSourcesOverADataSource::class.java)),
            "K2" to (compiled(BuildsTheDefaultDataSource::class.java) to
                probe(MemberRef("dev/octave/session/http/OctaveHttp", "callFactory", "(Ljava/lang/String;)Lokhttp3/Call\$Factory;"))),
            "K3" to (compiled(BuildsDefaultSources::class.java) to compiled(BuildsDefaultSourcesOverADataSource::class.java)),
            "K4" to (probe(MemberRef("okhttp3/OkHttpClient", "<init>", "()V")) to
                probe(MemberRef("okhttp3/Call\$Factory", "newCall", "(Lokhttp3/Request;)Lokhttp3/Call;"))),
            "K5" to (probe(MemberRef("java/net/URL", "openConnection", "()Ljava/net/URLConnection;")) to
                probe(MemberRef("java/net/URLEncoder", "encode", "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;"))),
            "K6" to (compiled(BuildsAPlayerWithDefaults::class.java) to compiled(BuildsAPlayerWithSources::class.java)),
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

    // Rule D8 (T3-29): octaveClasses() finds Octave's code by the dev/octave/ prefix, as the dex check does; a module
    // in another package would not be read here at all. The dex check's own guard runs on the same source, so the two
    // checks cannot disagree about which module is Octave's.
    @Test
    fun octave_modules_declare_only_octave_packages() {
        val (code, output) = modulePackages(BuildCheck.repoRoot)
        assertEquals(0, code, output)
        assertTrue(output.contains("all under dev.octave"), output)
    }

    @field:TempDir
    lateinit var tempRoot: File

    @Test
    fun a_module_in_another_package_fails() {
        val root = tempRoot
        val source = "modules/lan/android/src/main/java/com/example/lan/Lan.kt"
        root.resolve(source).apply { checkNotNull(parentFile).mkdirs() }.writeText("package com.example.lan\n\nclass Lan\n")
        val (code, output) = modulePackages(root)
        assertEquals(1, code, output)
        assertTrue(output.contains(source) && output.contains("com.example.lan"), output)
    }

    // --- helpers ---

    private fun modulePackages(root: File): Pair<Int, String> {
        val script = BuildCheck.repoRoot.resolve("scripts/octave-module-packages.mjs")
        val process = ProcessBuilder("node", script.path, "--root", root.path).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        assertTrue(process.waitFor(60, TimeUnit.SECONDS), "node did not finish running ${script.path}")
        return process.exitValue() to output
    }

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

    private companion object {
        // The Media3 version the RTSP and RTMP names below were re-read at in Media3's source (T8-02 item 9).
        const val MEDIA3_NAMES_READ_AT = "1.11.1"
        const val RTSP_FACTORY = "androidx/media3/exoplayer/rtsp/RtspMediaSource\$Factory"
        const val RTMP_FACTORY = "androidx/media3/datasource/rtmp/RtmpDataSource\$Factory"
    }
}
