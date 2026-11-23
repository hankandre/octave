package dev.octave.buildcheck

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T8-02, the Product Owner ruling of 2026-11-23 (tasks/product-owner-log.md, "2026-11-23, T8-02 ruling, Check",
// points 4 and 5): K7 refuses Media3's OkHttp data source (row M1) everywhere but one shape: a class under
// dev/octave/player/media3/ may construct its factory over a Call.Factory, judged by member reference and instruction,
// and do nothing else with it. Before R8 nothing is inlined, so the inlined shape of D4 has no K7 twin. The passing
// compiled sample is the engine's own class; the failing ones are probes. Not frozen.
class NetworkPathRulesMedia3Test {
    private val dataSource = "androidx/media3/datasource/okhttp/OkHttpDataSource"
    private val factory = "$dataSource\$Factory"
    private val constructor = MemberRef(factory, "<init>", "(Lokhttp3/Call\$Factory;)V")
    private val engine = "dev/octave/player/media3/Probe"

    private fun k7(refs: ClassRefs) = NetworkPathRules.check(refs).filter { it.rule == "K7" }

    private fun probe(
        name: String = engine,
        members: List<MemberRef> = listOf(constructor),
        utf8: Set<String> = emptySet(),
        operands: List<TypeOperand> = listOf(TypeOperand("new", factory)),
        supertypes: Set<String> = emptySet(),
        nests: Map<String, String> = mapOf(factory to dataSource),
    ): ClassRefs {
        val strings = members.flatMap { listOf(it.owner, it.name, it.descriptor) }.toSet() + utf8
        return ClassRefs(name, members.map { it.owner }.toSet(), members, strings, operands, supertypes, nests)
    }

    private fun assertPasses(refs: ClassRefs) = assertEquals(emptyList<NetworkViolation>(), NetworkPathRules.check(refs), "$refs")

    private fun assertFailsK7(refs: ClassRefs) = assertTrue(k7(refs).isNotEmpty(), "K7 on $refs: ${NetworkPathRules.check(refs)}")

    @Test
    fun the_engines_compiled_class_constructs_the_factory_and_passes() {
        val resource = "dev/octave/player/media3/Media3Handle.class"
        val bytes = checkNotNull(javaClass.classLoader?.getResourceAsStream(resource)) { "$resource is not on :app's test classpath" }.use { it.readBytes() }
        val refs = ClassReferences.read(bytes)
        assertTrue(constructor in refs.members, "the engine calls the constructor: ${refs.members.filter { it.owner.startsWith(dataSource) }}")
        assertTrue(TypeOperand("new", factory) in refs.typeOperands, "the engine makes a new factory: ${refs.typeOperands}")
        assertEquals(mapOf(factory to dataSource), refs.nests.filterKeys { it.startsWith(dataSource) })
        assertPasses(refs)
    }

    @Test
    fun the_constructor_and_its_new_pass_from_the_engine_package() {
        assertPasses(probe())
        assertPasses(probe(utf8 = setOf(dataSource)))
    }

    @Test
    fun the_same_constructor_fails_from_another_package() {
        for (name in listOf("dev/octave/tv/Probe", "dev/octave/player/Probe", "dev/octave/player/media3x/Probe", "dev/octave/session/http/Probe")) {
            assertFailsK7(probe(name = name))
        }
    }

    @Test
    fun any_other_member_fails_from_the_engine_package() {
        for (member in listOf(
            MemberRef(factory, "setUserAgent", "(Ljava/lang/String;)L$factory;"),
            MemberRef(factory, "setDefaultRequestProperties", "(Ljava/util/Map;)L$factory;"),
            MemberRef(factory, "createDataSource", "()L$dataSource;"),
            MemberRef(dataSource, "<init>", "(Lokhttp3/Call\$Factory;)V"),
            MemberRef("dev/octave/player/media3/Probe", "factory", "L$factory;"),
            MemberRef("dev/octave/player/media3/Probe", "build", "()L$factory;"),
        )) {
            assertFailsK7(probe(members = listOf(constructor, member)))
        }
    }

    @Test
    fun a_descriptor_signature_or_string_naming_the_class_fails_from_the_engine_package() {
        for (text in listOf("L$factory;", "(L$factory;)V", "Ljava/util/List<L$factory;>;", factory.replace('/', '.'), "L$dataSource;")) {
            assertFailsK7(probe(utf8 = setOf(text)))
        }
    }

    @Test
    fun a_cast_type_check_class_literal_or_array_fails_from_the_engine_package() {
        for (operand in listOf(
            TypeOperand("checkcast", factory),
            TypeOperand("instanceof", factory),
            TypeOperand("ldc", factory),
            TypeOperand("anewarray", factory),
            TypeOperand("new", dataSource),
            TypeOperand("checkcast", dataSource),
        )) {
            assertFailsK7(probe(operands = listOf(TypeOperand("new", factory), operand)))
        }
    }

    @Test
    fun the_outer_class_name_fails_unless_it_is_the_factorys_nest() {
        assertFailsK7(probe(utf8 = setOf(dataSource), nests = emptyMap()))
        assertFailsK7(probe(utf8 = setOf(dataSource), nests = mapOf(factory to "dev/octave/player/media3/Other")))
    }

    @Test
    fun a_subclass_or_a_class_with_no_constructor_call_fails_from_the_engine_package() {
        assertFailsK7(probe(supertypes = setOf(factory)))
        assertFailsK7(probe(members = emptyList(), utf8 = setOf(factory), operands = emptyList()))
    }
}
