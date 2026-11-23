package dev.octave.buildcheck

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.net.JarURLConnection
import java.util.jar.JarFile

// T8-02 item 8 (docs/specs/T8-02.md, "Build fences"): Media3's OkHttp data source links against the OkHttp the one
// client uses, and reads neither a network, prior or cache response nor a header of the request a response carries,
// since the one client's SessionInterceptor returns the caller's request with no network or prior response
// (decision 0005). It reads the class files of androidx/media3/datasource/okhttp/OkHttpDataSource*.class from the
// test runtime classpath with ClassReferences; Media3 is named by reflection only, so this file compiles before
// Media3 is on :app's test classpath and fails there instead. The play through it is item 7's wire test (D10).
class Media3OkHttpLinkTest {
    private val prefix = "androidx/media3/datasource/okhttp/OkHttpDataSource"

    // The banned reads, as owner and member name: any descriptor.
    private val banned = setOf(
        "okhttp3/Response" to "networkResponse",
        "okhttp3/Response" to "priorResponse",
        "okhttp3/Response" to "cacheResponse",
        "okhttp3/Request" to "header",
        "okhttp3/Request" to "headers",
    )

    // A planted reader of each banned kind: the scan must see it.
    private class ReadsNetworkResponse {
        fun read(response: okhttp3.Response): okhttp3.Response? = response.networkResponse
    }

    private class ReadsARequestHeader {
        fun read(response: okhttp3.Response): String? = response.request.header("Range")
    }

    private fun pin(path: String, name: String): String {
        val text = File(BuildCheck.repoRoot, path).readText()
        return checkNotNull(Regex("""def\s+$name\s*=\s*['"]([^'"]+)['"]""").find(text)) { "$path has no def $name" }.groupValues[1]
    }

    private fun bytesOf(type: Class<*>): ByteArray {
        val resource = type.name.replace('.', '/') + ".class"
        return checkNotNull(checkNotNull(type.classLoader).getResourceAsStream(resource)) { "cannot read $resource" }.use { it.readBytes() }
    }

    // Every class file whose internal name starts with OkHttpDataSource in Media3's okhttp package, by name.
    private fun dataSourceClasses(): Map<String, ClassRefs> {
        val loader = checkNotNull(javaClass.classLoader)
        val url = loader.getResource("$prefix.class")
        assertTrue(url != null, "$prefix.class is not on the test runtime classpath: add media3-datasource-okhttp to :app's tests (with-app-jvm-tests.js)")
        val found = sortedMapOf<String, ClassRefs>()
        fun add(name: String, bytes: () -> ByteArray) {
            if (name.startsWith(prefix) && name.endsWith(".class") && !name.removePrefix(prefix).contains('/')) {
                found[name.removeSuffix(".class")] = ClassReferences.read(bytes())
            }
        }
        when (url!!.protocol) {
            "jar" -> JarFile(File((url.openConnection() as JarURLConnection).jarFileURL.toURI())).use { jar ->
                for (entry in jar.entries()) add(entry.name) { jar.getInputStream(entry).use { it.readBytes() } }
            }
            "file" -> {
                val dir = checkNotNull(File(url.toURI()).parentFile)
                val packagePath = prefix.substringBeforeLast('/')
                dir.listFiles().orEmpty().filter { it.isFile }.forEach { file -> add("$packagePath/${file.name}") { file.readBytes() } }
            }
            else -> error("cannot list ${url.protocol} classpath entries")
        }
        return found
    }

    private fun bannedReads(refs: ClassRefs): List<MemberRef> = refs.members.filter { (it.owner to it.name) in banned }

    private fun descriptorOf(type: Class<*>): String = when {
        type == Void.TYPE -> "V"
        type == java.lang.Boolean.TYPE -> "Z"
        type == java.lang.Byte.TYPE -> "B"
        type == java.lang.Character.TYPE -> "C"
        type == java.lang.Short.TYPE -> "S"
        type == java.lang.Integer.TYPE -> "I"
        type == java.lang.Long.TYPE -> "J"
        type == java.lang.Float.TYPE -> "F"
        type == java.lang.Double.TYPE -> "D"
        type.isArray -> "[" + descriptorOf(type.componentType)
        else -> "L" + type.name.replace('.', '/') + ";"
    }

    private fun descriptorOf(method: Method): String =
        method.parameterTypes.joinToString("", "(", ")") { descriptorOf(it) } + descriptorOf(method.returnType)

    private fun hierarchy(type: Class<*>): List<Class<*>> {
        val seen = linkedSetOf<Class<*>>()
        fun walk(current: Class<*>?) {
            if (current == null || !seen.add(current)) return
            walk(current.superclass)
            current.interfaces.forEach(::walk)
        }
        walk(type)
        return seen.toList()
    }

    // True when the member exists on OkHttp's runtime class (or what it inherits) with that name and descriptor.
    private fun resolves(ref: MemberRef): Boolean {
        val owner = try {
            Class.forName(ref.owner.replace('/', '.'), false, javaClass.classLoader)
        } catch (missing: ClassNotFoundException) {
            return false
        }
        if (!ref.descriptor.startsWith("(")) {
            return hierarchy(owner).any { type -> type.declaredFields.any { field: Field -> field.name == ref.name && descriptorOf(field.type) == ref.descriptor } }
        }
        if (ref.name == "<init>") {
            return owner.declaredConstructors.any { constructor ->
                constructor.parameterTypes.joinToString("", "(", ")V") { descriptorOf(it) } == ref.descriptor
            }
        }
        return hierarchy(owner).any { type -> type.declaredMethods.any { it.name == ref.name && descriptorOf(it) == ref.descriptor } }
    }

    // Read by reflection: OkHttp.VERSION is a compile-time constant, so naming it would inline the compile classpath's.
    private fun runtimeOkHttp(): Any? = Class.forName("okhttp3.OkHttp", true, javaClass.classLoader).getField("VERSION").get(null)

    @Test
    fun the_runtime_okhttp_is_the_session_modules_pin() {
        assertEquals(pin("modules/session/android/build.gradle", "okhttpVersion"), runtimeOkHttp())
    }

    @Test
    fun media3_on_the_classpath_is_the_players_pin() {
        val version = Class.forName("androidx.media3.common.MediaLibraryInfo", false, javaClass.classLoader).getField("VERSION").get(null)
        assertEquals(pin("modules/player/android/build.gradle", "media3Version"), version)
    }

    @Test
    fun the_scan_reads_the_data_source_and_its_factory() {
        val classes = dataSourceClasses()
        assertTrue(prefix in classes, "read ${classes.keys}")
        assertTrue("$prefix\$Factory" in classes, "read ${classes.keys}")
        val okhttp = classes.values.flatMap { it.members }.filter { it.owner.startsWith("okhttp3/") }
        assertTrue(okhttp.any { it.owner == "okhttp3/Call\$Factory" && it.name == "newCall" }, "the data source calls Call.Factory.newCall: $okhttp")
    }

    @Test
    fun every_okhttp_member_the_data_source_references_resolves_on_the_runtime_okhttp() {
        val refs = dataSourceClasses().values.flatMap { it.members }.filter { it.owner.startsWith("okhttp3/") }.distinct()
        assertTrue(refs.isNotEmpty(), "no okhttp3 member read")
        val missing = refs.filterNot(::resolves)
        assertEquals(emptyList<MemberRef>(), missing, "okhttp3 members Media3's OkHttp data source references that OkHttp ${runtimeOkHttp()} lacks")
    }

    @Test
    fun the_data_source_reads_no_network_prior_or_cache_response_and_no_header_of_the_response_request() {
        val found = dataSourceClasses().mapValues { (_, refs) -> bannedReads(refs) }.filterValues { it.isNotEmpty() }
        assertEquals(emptyMap<String, List<MemberRef>>(), found)
    }

    @Test
    fun the_scan_catches_a_planted_reader() {
        val network = bannedReads(ClassReferences.read(bytesOf(ReadsNetworkResponse::class.java)))
        assertTrue(network.any { it.owner == "okhttp3/Response" && it.name == "networkResponse" }, "planted networkResponse read: $network")
        val header = bannedReads(ClassReferences.read(bytesOf(ReadsARequestHeader::class.java)))
        assertTrue(header.any { it.owner == "okhttp3/Request" && it.name == "header" }, "planted request header read: $header")
    }
}
