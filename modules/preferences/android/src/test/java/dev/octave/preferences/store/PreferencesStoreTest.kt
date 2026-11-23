package dev.octave.preferences.store

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// T9-02: the store keeps the device's preferences record in one file of the directory it is given, and accepts only the
// record's shape (D4). The vectors are shared with the core's tests in packages/core/tests/fixtures/preference-records.json.
class PreferencesStoreTest {
    @TempDir
    lateinit var directory: File

    private val file get() = File(directory, PreferencesStore.FILE_NAME)
    private val temporary get() = File(directory, PreferencesStore.TEMPORARY_NAME)

    private val first = """{"version":1,"streamingLimits":{"localMbps":20}}"""
    private val second = """{"version":1,"streamingLimits":{"localMbps":40,"remoteMbps":4}}"""

    private fun assertOnlyTheRecordFile() {
        assertEquals(listOf(PreferencesStore.FILE_NAME), directory.list()!!.sorted())
    }

    @Test
    fun a_written_record_reads_back() {
        val store = PreferencesStore(directory)
        assertTrue(store.write(first))
        assertEquals(first, store.read())
        assertEquals(first, file.readText())
        assertOnlyTheRecordFile()
    }

    @Test
    fun a_second_write_replaces_the_first() {
        val store = PreferencesStore(directory)
        assertTrue(store.write(first))
        assertTrue(store.write(second))
        assertEquals(second, store.read())
        assertOnlyTheRecordFile()
    }

    @Test
    fun a_new_store_on_the_same_directory_reads_what_the_first_wrote_as_after_a_relaunch() {
        assertTrue(PreferencesStore(directory).write(second))
        assertEquals(second, PreferencesStore(directory).read())
    }

    @Test
    fun no_file_reads_null() {
        assertNull(PreferencesStore(directory).read())
        assertEquals(emptyList<String>(), directory.list()!!.toList())
    }

    @Test
    fun the_shared_vectors_hold_the_81_limit_combinations_and_a_refused_set() {
        val vectors = SharedVectors.load()
        assertEquals(81, vectors.accepted.size)
        assertEquals(81, vectors.accepted.toSet().size)
        assertTrue(vectors.refused.isNotEmpty())
        assertEquals(emptySet<String>(), vectors.accepted.toSet().intersect(vectors.refused.toSet()))
    }

    @Test
    fun every_accepted_vector_writes_and_reads_back_unchanged() {
        val store = PreferencesStore(directory)
        for (record in SharedVectors.load().accepted) {
            assertTrue(PreferencesStore.isAllowedRecord(record), record)
            assertTrue(store.write(record), record)
            assertEquals(record, store.read(), record)
            assertEquals(record, file.readText(), record)
            assertOnlyTheRecordFile()
        }
    }

    @Test
    fun every_refused_vector_is_refused_and_writes_nothing() {
        val store = PreferencesStore(directory)
        for (record in SharedVectors.load().refused) {
            assertFalse(PreferencesStore.isAllowedRecord(record), record)
            assertFalse(store.write(record), record)
            assertEquals(emptyList<String>(), directory.list()!!.toList(), record)
        }
    }

    @Test
    fun a_refused_vector_does_not_replace_a_stored_record() {
        val store = PreferencesStore(directory)
        assertTrue(store.write(first))
        for (record in SharedVectors.load().refused) {
            assertFalse(store.write(record), record)
            assertEquals(first, store.read(), record)
        }
    }

    @Test
    fun a_file_planted_with_a_refused_vector_reads_null() {
        for (record in SharedVectors.load().refused) {
            file.writeBytes(record.toByteArray(Charsets.UTF_8))
            assertNull(PreferencesStore(directory).read(), record)
        }
    }

    @Test
    fun text_over_1024_bytes_is_refused_and_a_planted_one_reads_null() {
        val long = "{\"version\":1,\"streamingLimits\":{}}" + " ".repeat(PreferencesStore.MAX_BYTES)
        assertTrue(long.toByteArray(Charsets.UTF_8).size > PreferencesStore.MAX_BYTES)
        assertFalse(PreferencesStore(directory).write(long))
        assertEquals(emptyList<String>(), directory.list()!!.toList())
        file.writeText(long)
        assertNull(PreferencesStore(directory).read())
        file.writeText("x".repeat(1025))
        assertNull(PreferencesStore(directory).read())
    }

    @Test
    fun a_directory_that_cannot_be_written_gives_false() {
        val missing = File(directory, "missing")
        assertFalse(PreferencesStore(missing).write(first))
        assertFalse(missing.exists())
        assertNull(PreferencesStore(missing).read())
    }

    @Test
    fun a_rename_that_returns_false_gives_false_and_leaves_no_temporary_file() {
        // A non-empty directory where the file should be: the temporary file is written and renameTo fails without
        // throwing.
        assertTrue(file.mkdir())
        File(file, "keep").writeText("x")
        val probe = File(directory, "probe")
        probe.writeText(first)
        assertFalse(probe.renameTo(file), "renameTo over a non-empty directory returns false on this JVM")
        assertTrue(probe.delete())

        assertFalse(PreferencesStore(directory).write(first))
        assertFalse(temporary.exists(), "no temporary file is left")
        assertTrue(file.isDirectory)
        assertNull(PreferencesStore(directory).read())
    }

    @Test
    fun a_leftover_temporary_file_is_not_read_as_the_record() {
        temporary.writeText(first)
        assertNull(PreferencesStore(directory).read())
    }

    @Test
    fun sixteen_threads_writing_leave_one_whole_record() {
        val records = SharedVectors.load().accepted.take(16)
        val pool = Executors.newFixedThreadPool(16)
        val start = CountDownLatch(1)
        val answers = records.map { record ->
            pool.submit<Boolean> {
                start.await()
                PreferencesStore(directory).write(record)
            }
        }
        start.countDown()
        val results = answers.map { it.get(10, TimeUnit.SECONDS) }
        pool.shutdown()
        assertTrue(results.all { it })
        assertTrue(PreferencesStore(directory).read() in records)
        assertOnlyTheRecordFile()
    }
}

// Reads packages/core/tests/fixtures/preference-records.json with no JSON library: the file is an object whose
// `accepted` and `refused` members are arrays of JSON strings.
private class SharedVectors(val accepted: List<String>, val refused: List<String>) {
    companion object {
        fun load(): SharedVectors {
            val root = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })
            val text = File(root, "packages/core/tests/fixtures/preference-records.json").readText(Charsets.UTF_8)
            return SharedVectors(stringArray(text, "accepted"), stringArray(text, "refused"))
        }

        private fun stringArray(text: String, member: String): List<String> {
            var at = text.indexOf("\"$member\"")
            check(at >= 0) { "no $member member" }
            at = text.indexOf('[', at) + 1
            val out = mutableListOf<String>()
            while (true) {
                while (text[at].isWhitespace() || text[at] == ',') at += 1
                if (text[at] == ']') return out
                check(text[at] == '"') { "a string in $member at $at" }
                at += 1
                val value = StringBuilder()
                while (text[at] != '"') {
                    if (text[at] == '\\') {
                        at += 1
                        when (val escape = text[at]) {
                            'n' -> value.append('\n')
                            't' -> value.append('\t')
                            'r' -> value.append('\r')
                            'b' -> value.append('\b')
                            'f' -> value.append('\u000c')
                            'u' -> {
                                value.append(text.substring(at + 1, at + 5).toInt(16).toChar())
                                at += 4
                            }
                            else -> value.append(escape)
                        }
                    } else {
                        value.append(text[at])
                    }
                    at += 1
                }
                at += 1
                out += value.toString()
            }
        }
    }
}
