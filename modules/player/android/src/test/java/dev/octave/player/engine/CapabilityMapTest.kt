package dev.octave.player.engine

import dev.octave.player.seam.Capabilities
import dev.octave.player.seam.PlayerEventMaps
import dev.octave.player.seam.TestJson
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T8-07 items 1 and 8 (docs/specs/T8-07.md, "Building the answer" and Test plan 2): CapabilityMap.capabilities(report)
// turns the platform's report into the port's PlayerCapabilities. The report is plain Kotlin:
// PlatformReport(video, audio, hdr, passthrough), PlatformVideoDecoder(codec, hardware, profiles, maxWidth, maxHeight)
// and PlatformProfile(name, bitDepth), each profile already named by PlatformNames. The rules: drop names outside the
// port's vocabularies; expand each profile by the implication table (D4); one VideoDecoder per (decoder, profile);
// maxBitDepth only for av1 and vp9; VP8 and VC-1 get one entry with no profile; a decoder whose profiles all map to
// nothing gets no entry; never emit a profile outside the reader's pattern (D5); dedupe; no video decoder left is
// Failed (D7). The order of videoDecoders is not pinned here; each entry must appear exactly once.
//
// A decoder of h264, hevc, av1, vp9, mpeg2video or mpeg4 reporting an empty profile list is not pinned (spec check
// issue 1: the implementer settles it against Media3 1.11.1's MediaCodecInfo).
class CapabilityMapTest {
    private val repoRoot = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set; run the tests through pnpm tv:native:test" })
    private val pattern = Regex("^[A-Za-z0-9 .+-]{1,32}$")

    @Suppress("UNCHECKED_CAST")
    private val cases: List<Map<String, Any?>> by lazy {
        val fixture = TestJson.parse(File(repoRoot, "packages/core/tests/fixtures/device-capability-probes.json").readText()) as Map<String, Any?>
        fixture["cases"] as List<Map<String, Any?>>
    }

    private fun int(value: Any?): Int? = (value as Double?)?.toInt()

    private fun strings(value: Any?): List<String> = (value as List<*>).map { it as String }

    private fun report(platform: Map<*, *>) = PlatformReport(
        video = (platform["video"] as List<*>).map { raw ->
            val decoder = raw as Map<*, *>
            PlatformVideoDecoder(
                codec = decoder["codec"] as String,
                hardware = decoder["hardware"] as Boolean,
                profiles = (decoder["profiles"] as List<*>).map { entry ->
                    val profile = entry as Map<*, *>
                    PlatformProfile(name = profile["name"] as String, bitDepth = int(profile["bitDepth"]))
                },
                maxWidth = int(decoder["maxWidth"]),
                maxHeight = int(decoder["maxHeight"]),
            )
        },
        audio = strings(platform["audio"]),
        hdr = strings(platform["hdr"]),
        passthrough = strings(platform["passthrough"]),
    )

    // JSON numbers arrive as Double; the maps PlayerEventMaps writes hold Int.
    private fun normalized(value: Any?): Any? = when (value) {
        is Double -> if (value == Math.floor(value)) value.toInt() else value
        is Map<*, *> -> value.entries.associate { (key, inner) -> key as String to normalized(inner) }
        is List<*> -> value.map { normalized(it) }
        else -> value
    }

    // A comparable form of a capability map: videoDecoders as a sorted list of entries with sorted keys.
    private fun comparable(map: Map<*, *>): Map<String, Any?> = map.entries.associate { (key, value) ->
        key as String to if (key == "videoDecoders") (value as List<*>).map { (it as Map<*, *>).entries.associate { (k, v) -> k as String to v }.toSortedMap().toString() }.sorted() else value
    }

    private fun answer(report: PlatformReport): Map<String, Any?> = PlayerEventMaps.toMap(CapabilityMap.capabilities(report))

    private fun decoders(report: PlatformReport): List<Map<String, Any?>> {
        val map = answer(report)
        assertEquals("complete", map["probe"], "probe for $report")
        @Suppress("UNCHECKED_CAST")
        return map["videoDecoders"] as List<Map<String, Any?>>
    }

    private fun profilesOf(codec: String, vararg names: String, bitDepth: Int? = null, hardware: Boolean = true): List<String?> =
        decoders(PlatformReport(video = listOf(PlatformVideoDecoder(codec = codec, hardware = hardware, profiles = names.map { PlatformProfile(name = it, bitDepth = bitDepth) }, maxWidth = null, maxHeight = null)), audio = emptyList(), hdr = emptyList(), passthrough = emptyList()))
            .map { it["profile"] as String? }

    private fun assertProfiles(expected: Set<String?>, actual: List<String?>, what: String) {
        assertEquals(expected, actual.toSet(), what)
        assertEquals(expected.size, actual.size, "$what: each entry once, got $actual")
    }

    @Test
    fun vectors_map_to_their_capabilities() {
        assertTrue(cases.size >= 10, "the shared vectors hold the spec's cases")
        val failures = cases.mapNotNull { case ->
            val expected = comparable(normalized(case["capabilities"]) as Map<*, *>)
            val actual = comparable(answer(report(case["platform"] as Map<*, *>)))
            if (expected == actual) null else "${case["name"]}:\n  expected $expected\n  actual   $actual"
        }
        assertTrue(failures.isEmpty(), failures.joinToString("\n"))
    }

    @Test
    fun vectors_emit_only_profiles_the_reader_keeps() {
        for (case in cases) {
            val map = answer(report(case["platform"] as Map<*, *>))
            for (decoder in (map["videoDecoders"] as List<*>?).orEmpty()) {
                val profile = (decoder as Map<*, *>)["profile"] as String? ?: continue
                assertTrue(pattern.matches(profile), "${case["name"]}: emitted profile '$profile'")
            }
        }
    }

    @Test
    fun profiles_h264_expand_by_the_implication_table() {
        assertProfiles(setOf("High 10", "High", "Main", "Constrained Baseline"), profilesOf("h264", "High 10"), "h264 High 10")
        assertProfiles(setOf("High", "Main", "Constrained Baseline"), profilesOf("h264", "High"), "h264 High")
        assertProfiles(setOf("Main", "Constrained Baseline"), profilesOf("h264", "Main"), "h264 Main")
        assertProfiles(setOf("Baseline", "Constrained Baseline"), profilesOf("h264", "Baseline"), "h264 Baseline")
        assertProfiles(setOf("Constrained Baseline"), profilesOf("h264", "Constrained Baseline"), "h264 Constrained Baseline")
        assertProfiles(setOf("Extended"), profilesOf("h264", "Extended"), "h264 Extended")
    }

    @Test
    fun profiles_hevc_mpeg2_and_mpeg4_expand_by_the_implication_table() {
        assertProfiles(setOf("Main 10", "Main"), profilesOf("hevc", "Main 10"), "hevc Main 10")
        assertProfiles(setOf("Main"), profilesOf("hevc", "Main"), "hevc Main")
        assertProfiles(setOf("Main Still Picture"), profilesOf("hevc", "Main Still Picture"), "hevc Main Still Picture")
        assertProfiles(setOf("High", "Main", "Simple"), profilesOf("mpeg2video", "High"), "mpeg2video High")
        assertProfiles(setOf("Main", "Simple"), profilesOf("mpeg2video", "Main"), "mpeg2video Main")
        assertProfiles(setOf("Advanced Simple Profile", "Simple Profile"), profilesOf("mpeg4", "Advanced Simple Profile"), "mpeg4 ASP")
        assertProfiles(setOf("Simple Profile"), profilesOf("mpeg4", "Simple Profile"), "mpeg4 SP")
    }

    @Test
    fun profiles_av1_and_vp9_imply_nothing_and_carry_their_bit_depth() {
        val av1 = decoders(PlatformReport(video = listOf(PlatformVideoDecoder(codec = "av1", hardware = true, profiles = listOf(PlatformProfile(name = "Main", bitDepth = 8), PlatformProfile(name = "Main", bitDepth = 10)), maxWidth = null, maxHeight = null)), audio = emptyList(), hdr = emptyList(), passthrough = emptyList()))
        assertEquals(setOf(8, 10), av1.map { it["maxBitDepth"] }.toSet(), "av1 Main8 and Main10: $av1")
        assertEquals(2, av1.size, "av1: $av1")
        assertTrue(av1.all { it["profile"] == "Main" }, "av1: $av1")
        assertProfiles(setOf("Profile 2"), profilesOf("vp9", "Profile 2", bitDepth = 10), "vp9 Profile 2")
        assertProfiles(setOf("Profile 0"), profilesOf("vp9", "Profile 0", bitDepth = 8), "vp9 Profile 0")
    }

    @Test
    fun profiles_of_h264_and_hevc_state_no_bit_depth() {
        val entries = decoders(PlatformReport(video = listOf(PlatformVideoDecoder(codec = "h264", hardware = true, profiles = listOf(PlatformProfile(name = "High 10", bitDepth = 10)), maxWidth = null, maxHeight = null), PlatformVideoDecoder(codec = "hevc", hardware = true, profiles = listOf(PlatformProfile(name = "Main 10", bitDepth = 10)), maxWidth = null, maxHeight = null)), audio = emptyList(), hdr = emptyList(), passthrough = emptyList()))
        assertTrue(entries.isNotEmpty())
        for (entry in entries) assertTrue("maxBitDepth" !in entry, "no maxBitDepth on $entry")
    }

    @Test
    fun profiles_outside_the_reader_pattern_are_dropped_with_their_entry() {
        val names = listOf("High 4:4:4 Predictive", "High 4:2:2", "Main", "A profile name far longer than thirty-two characters", "")
        assertProfiles(setOf("Main", "Constrained Baseline"), profilesOf("h264", *names.toTypedArray()), "h264 with unusable names")
    }

    @Test
    fun profiles_of_vp8_and_vc1_are_left_out() {
        assertEquals(listOf<String?>(null), profilesOf("vp8", "Main", hardware = false), "vp8")
        assertEquals(listOf<String?>(null), profilesOf("vc1", "Advanced"), "vc1")
        assertEquals(listOf<String?>(null), profilesOf("vc1"), "vc1 with no profile")
    }

    @Test
    fun report_carries_hardware_sizes_audio_hdr_and_passthrough_within_the_vocabularies() {
        val report = PlatformReport(
            video = listOf(
                PlatformVideoDecoder(codec = "hevc", hardware = true, profiles = listOf(PlatformProfile(name = "Main", bitDepth = null)), maxWidth = 3840, maxHeight = 2160),
                PlatformVideoDecoder(codec = "hevc", hardware = false, profiles = listOf(PlatformProfile(name = "Main", bitDepth = null)), maxWidth = null, maxHeight = null),
                PlatformVideoDecoder(codec = "wmv3", hardware = true, profiles = emptyList(), maxWidth = null, maxHeight = null),
            ),
            audio = listOf("aac", "eac3", "pcm_s16le", "wmav2"),
            hdr = listOf("hdr10", "dolby-vision", "hdr-vivid"),
            passthrough = listOf("eac3-joc", "dts-hd", "mpegh"),
        )
        val map = answer(report)
        assertEquals("complete", map["probe"])
        assertEquals(
            setOf(
                mapOf("codec" to "hevc", "hardware" to true, "profile" to "Main", "maxWidth" to 3840, "maxHeight" to 2160),
                mapOf("codec" to "hevc", "hardware" to false, "profile" to "Main"),
            ),
            (map["videoDecoders"] as List<*>).map { (it as Map<*, *>).entries.associate { (k, v) -> k as String to v } }.toSet(),
        )
        assertEquals(listOf("aac", "eac3", "pcm_s16le"), map["audioDecoders"])
        assertEquals(listOf("hdr10", "dolby-vision"), map["hdr"])
        assertEquals(listOf("eac3-joc", "dts-hd"), map["passthrough"])
    }

    @Test
    fun report_whose_decoders_all_map_to_nothing_is_failed() {
        val unknown = PlatformReport(video = listOf(PlatformVideoDecoder(codec = "msmpeg4v3", hardware = false, profiles = emptyList(), maxWidth = null, maxHeight = null)), audio = listOf("aac"), hdr = emptyList(), passthrough = emptyList())
        assertEquals(Capabilities.Failed, CapabilityMap.capabilities(unknown))
        val unusable = PlatformReport(video = listOf(PlatformVideoDecoder(codec = "h264", hardware = true, profiles = listOf(PlatformProfile(name = "High 4:2:2", bitDepth = null)), maxWidth = null, maxHeight = null)), audio = listOf("aac"), hdr = emptyList(), passthrough = emptyList())
        assertEquals(Capabilities.Failed, CapabilityMap.capabilities(unusable))
    }
}
