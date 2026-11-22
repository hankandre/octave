package dev.octave.installid.store

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// T4-09: the store keeps one lowercase version 4 UUID in one file of the directory it is given, and nothing else.
class InstallIdStoreTest {
    @TempDir
    lateinit var directory: File

    private val first = "0b6f3c2e-8d1a-4f5b-9c7e-2a4d6e8f0a1b"
    private val second = "7e1d9a4c-3b2f-4a6e-8d5c-1f0e9b8a7c6d"

    private val file get() = File(directory, InstallIdStore.FILE_NAME)
    private val temporary get() = File(directory, InstallIdStore.TEMPORARY_NAME)

    private fun assertOnlyTheIdFile() {
        assertEquals(listOf(InstallIdStore.FILE_NAME), directory.list()!!.sorted())
        assertEquals(36L, file.length())
    }

    @Test
    fun the_first_keep_stores_and_answers_the_candidate() {
        assertEquals(first, InstallIdStore(directory).keep(first))
        assertEquals(first, file.readText())
        assertOnlyTheIdFile()
    }

    @Test
    fun a_second_keep_answers_the_stored_id_not_its_candidate() {
        val store = InstallIdStore(directory)
        store.keep(first)
        assertEquals(first, store.keep(second))
        assertOnlyTheIdFile()
    }

    @Test
    fun a_new_store_on_the_same_directory_answers_the_stored_id_as_after_a_relaunch() {
        InstallIdStore(directory).keep(first)
        assertEquals(first, InstallIdStore(directory).keep(second))
        assertOnlyTheIdFile()
    }

    @Test
    fun an_emptied_directory_gives_the_new_candidate_as_after_cleared_data() {
        InstallIdStore(directory).keep(first)
        directory.listFiles()!!.forEach { it.delete() }
        assertEquals(second, InstallIdStore(directory).keep(second))
        assertEquals(second, file.readText())
        assertOnlyTheIdFile()
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "0B6F3C2E-8D1A-4F5B-9C7E-2A4D6E8F0A1B",
            "0b6f3c2e-8d1a-1f5b-9c7e-2a4d6e8f0a1b",
            "0b6f3c2e-8d1a-4f5b-9c7e-2a4d6e8f0a1",
            "0b6f3c2e-8d1a-4f5b-9c7e-2a4d6e8f0a1bc",
            "",
            "0123456789abcdef0123456789abcdef",
            "0b6f3c2e-8d1a-4f5b-9c7e-2a4d6e8f0a1b\n",
            "0b6f3c2e-8d1a-4f5b-7c7e-2a4d6e8f0a1b",
        ],
    )
    fun a_candidate_that_is_not_a_lowercase_version_4_uuid_is_refused_and_nothing_is_written(candidate: String) {
        assertNull(InstallIdStore(directory).keep(candidate))
        assertEquals(emptyList<String>(), directory.list()!!.toList())
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "junk",
            "",
            "7e1d9a4c-3b2f-4a6e-8d5c-1f0e9b8a7c6d\n",
            "7e1d9a4c-3b2f-4a6e-8d5c-1f0e9b8a7c6dXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
            "7E1D9A4C-3B2F-4A6E-8D5C-1F0E9B8A7C6D",
        ],
    )
    fun a_file_that_holds_anything_but_one_valid_id_is_replaced(content: String) {
        file.writeText(content)
        assertEquals(first, InstallIdStore(directory).keep(first))
        assertEquals(first, file.readText())
        assertOnlyTheIdFile()
    }

    @Test
    fun a_directory_that_cannot_be_written_gives_null() {
        val missing = File(directory, "missing")
        assertNull(InstallIdStore(missing).keep(first))
        assertFalse(missing.exists())
    }

    @Test
    fun a_rename_that_returns_false_gives_null_and_leaves_no_temporary_file() {
        // A non-empty directory where the file should be: the temporary file is written and renameTo fails without
        // throwing.
        assertTrue(file.mkdir())
        File(file, "keep").writeText("x")
        val probe = File(directory, "probe")
        probe.writeText(first)
        assertFalse(probe.renameTo(file), "renameTo over a non-empty directory returns false on this JVM")
        assertTrue(probe.delete())

        assertNull(InstallIdStore(directory).keep(first))
        assertFalse(temporary.exists(), "no temporary file is left")
        assertTrue(file.isDirectory)
    }

    @Test
    fun a_leftover_temporary_file_is_not_read_as_an_id() {
        temporary.writeText(second)
        assertEquals(first, InstallIdStore(directory).keep(first))
        assertEquals(first, file.readText())
        assertOnlyTheIdFile()
    }

    @Test
    fun sixteen_threads_with_sixteen_candidates_all_get_one_value() {
        val candidates = (0 until 16).map { String.format("%08x-0000-4000-8000-%012x", it, it) }
        val pool = Executors.newFixedThreadPool(16)
        val start = CountDownLatch(1)
        val answers = candidates.map { candidate ->
            pool.submit<String?> {
                start.await()
                InstallIdStore(directory).keep(candidate)
            }
        }
        start.countDown()
        val values = answers.map { it.get(10, TimeUnit.SECONDS) }.toSet()
        pool.shutdown()
        assertEquals(1, values.size)
        assertTrue(values.single() in candidates)
        assertEquals(values.single(), file.readText())
        assertOnlyTheIdFile()
    }
}
