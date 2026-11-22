package dev.octave.buildcheck

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.TimeUnit

// T3-29 item 3: K4 by type refuses the dex check's socket, socket factory, channel and provider classes and its two
// media readers in Octave's compiled classes, before R8. Only the one client may name what makes a client socket.
class NetworkPathSocketsTest {
    private val directSocketFactory = "dev/octave/session/http/DirectSocketFactory"
    private val octaveHttp = "dev/octave/session/http/OctaveHttp"

    // A class that names `type` as a class constant, in a descriptor, and as a reflective dotted string.
    private fun naming(type: String, name: String = "dev/octave/tv/Probe"): List<ClassRefs> = listOf(
        ClassRefs(name, setOf(type), emptyList(), setOf(type)),
        ClassRefs(name, emptySet(), emptyList(), setOf("(L$type;)V")),
        ClassRefs(name, emptySet(), emptyList(), setOf(type.replace('/', '.'))),
    )

    private fun k4(refs: ClassRefs) = NetworkPathRules.check(refs).filter { it.rule == "K4" }

    private fun assertRefused(type: String, name: String = "dev/octave/tv/Probe") {
        for (refs in naming(type, name)) assertTrue(k4(refs).any { it.what == type }, "K4 on $type in $name: $refs")
    }

    private fun assertAllowed(type: String, name: String) {
        for (refs in naming(type, name)) assertEquals(emptyList<NetworkViolation>(), NetworkPathRules.check(refs), "$type in $name: $refs")
    }

    @Test
    fun sockets_channels_and_providers_fail_k4() {
        listOf(
            "java/net/ServerSocket",
            "java/net/DatagramSocket",
            "java/net/MulticastSocket",
            "javax/net/ssl/SSLSocket",
            "javax/net/ssl/SSLServerSocket",
            "java/nio/channels/SocketChannel",
            "java/nio/channels/ServerSocketChannel",
            "java/nio/channels/DatagramChannel",
            "java/nio/channels/AsynchronousSocketChannel",
            "java/nio/channels/AsynchronousServerSocketChannel",
            "javax/net/ServerSocketFactory",
            "javax/net/ssl/SSLSocketFactory",
            "javax/net/ssl/SSLServerSocketFactory",
            "android/net/SSLCertificateSocketFactory",
            "java/nio/channels/spi/SelectorProvider",
            "java/nio/channels/spi/AsynchronousChannelProvider",
            "java/net/Socket",
            "javax/net/SocketFactory",
        ).forEach { assertRefused(it) }
        // A nested class of one is refused too.
        assertTrue(k4(ClassRefs("dev/octave/tv/Probe", emptySet(), emptyList(), setOf("java/net/ServerSocket\$Inner"))).isNotEmpty())
    }

    @Test
    fun the_media_readers_fail_k4() {
        assertRefused("android/media/MediaExtractor")
        assertRefused("android/media/MediaMetadataRetriever")
        // Whole, in the one client too: S6 lets a library read an open file with them, Octave not at all.
        assertRefused("android/media/MediaExtractor", directSocketFactory)
    }

    @Test
    fun only_the_one_client_may_make_a_client_socket() {
        assertAllowed("java/net/Socket", directSocketFactory)
        assertAllowed("javax/net/SocketFactory", directSocketFactory)
        assertAllowed("javax/net/SocketFactory", octaveHttp)
        assertRefused("java/net/Socket", octaveHttp)
        assertRefused("java/net/Socket", "dev/octave/session/http/SessionCallFactory")
        assertRefused("javax/net/SocketFactory", "dev/octave/session/http/SessionCallFactory")
        // The one client's socket factory may not name a listening or datagram socket at all.
        assertRefused("java/net/ServerSocket", directSocketFactory)
        assertRefused("java/net/DatagramSocket", directSocketFactory)
        assertRefused("java/nio/channels/spi/SelectorProvider", directSocketFactory)
    }

    @Test
    fun socket_exceptions_and_addresses_pass() {
        for (type in listOf("java/net/SocketTimeoutException", "java/net/SocketException", "java/net/InetSocketAddress", "java/net/SocketAddress", "java/net/SocketOption")) {
            assertAllowed(type, "dev/octave/tv/Probe")
        }
    }

    // The dex check's lists, read with Node as NetworkPathRulesCoverageTest does: every class of S4's methods, every
    // framework subclass whose chain reaches one, and the classes of S6's entry with localOverloads must be refused;
    // the classes of S4's oneClientMethods must not be refused in DirectSocketFactory.
    private fun dexSocketClasses(): Pair<List<String>, List<String>> {
        val lists = BuildCheck.repoRoot.resolve("scripts/tv-apk-dex-lists.mjs")
        val script = "const m = await import(process.argv[1]); " +
            "const s4 = m.NETWORK_SINKS.find((s) => s.id === 'S4'); const s6 = m.NETWORK_SINKS.find((s) => s.id === 'S6'); " +
            "const s4Classes = new Set(s4.methods.flatMap((e) => e.classes)); " +
            "const reaches = (c) => { for (let at = c, n = 0; at && n < 20; at = m.FRAMEWORK_SUPERCLASSES[at], n += 1) if (s4Classes.has(at)) return true; return false; }; " +
            "const refused = [...s4Classes, ...Object.keys(m.FRAMEWORK_SUPERCLASSES).filter(reaches), " +
            "...s6.methods.filter((e) => e.localOverloads !== undefined).flatMap((e) => e.classes)]; " +
            "const oneClient = (s4.oneClientMethods ?? []).flatMap((e) => e.classes); " +
            "process.stdout.write([...new Set(refused)].join(',') + '\\n' + oneClient.join(','));"
        val process = ProcessBuilder("node", "--input-type=module", "-e", script, lists.toURI().toString())
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.bufferedReader().readText()
        assertTrue(process.waitFor(60, TimeUnit.SECONDS), "node did not finish reading ${lists.path}")
        assertEquals(0, process.exitValue(), "node could not read ${lists.path}: $output")
        val (refused, oneClient) = output.lines().let { it[0] to it.getOrElse(1) { "" } }
        val split = { text: String -> text.split(',').filter { it.isNotBlank() }.map { it.replace('.', '/') } }
        return split(refused) to split(oneClient)
    }

    @Test
    fun every_socket_sink_of_the_dex_check_is_refused_by_k4() {
        val (refused, oneClient) = dexSocketClasses()
        assertTrue(refused.size >= 20, "read ${refused.size} socket and media classes: $refused")
        assertTrue("android/net/SSLCertificateSocketFactory" in refused, "the framework subclass walk: $refused")
        val uncovered = refused.filter { type -> k4(ClassRefs("dev/octave/tv/Probe", setOf(type), emptyList(), setOf(type))).none { it.what == type } }
        assertEquals(emptyList<String>(), uncovered, "add each to K4 by type in NetworkPathRules.kt")
        assertEquals(listOf("java/net/Socket", "javax/net/SocketFactory"), oneClient.sorted())
        val refusedInTheClient = oneClient.filter { type -> k4(ClassRefs(directSocketFactory, setOf(type), emptyList(), setOf(type))).isNotEmpty() }
        assertEquals(emptyList<String>(), refusedInTheClient, "DirectSocketFactory may make a client socket")
    }
}
