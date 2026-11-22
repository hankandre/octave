package dev.octave.installid.store

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException

// The interface a Swift implementation mirrors (T4-09).
interface InstallIdKeeper {
    // The stored id; or, when none is stored, the candidate after storing it; or null when the candidate is refused or
    // the store cannot be read or written.
    fun keep(candidate: String): String?
}

// One file, `octave-install-id`, in the directory it is given (the app's no-backup directory). It holds one lowercase
// version 4 UUID and nothing else: a candidate of any other form is refused and nothing is written. Plain Kotlin, no
// Android class. Nothing is logged and no message leaves keep().
class InstallIdStore(private val directory: File) : InstallIdKeeper {
    override fun keep(candidate: String): String? {
        if (!isInstallId(candidate)) return null
        synchronized(LOCK) {
            return try {
                read() ?: store(candidate)
            } catch (_: IOException) {
                null
            } catch (_: SecurityException) {
                null
            }
        }
    }

    // The stored id when the file holds exactly one valid id; null for anything else, a missing file included.
    private fun read(): String? {
        val file = File(directory, FILE_NAME)
        if (!file.isFile) return null
        val buffer = ByteArray(MAX_READ)
        var length = 0
        FileInputStream(file).use { input ->
            while (length < MAX_READ) {
                val count = input.read(buffer, length, MAX_READ - length)
                if (count < 0) break
                length += count
            }
        }
        val text = String(buffer, 0, length, Charsets.US_ASCII)
        return if (isInstallId(text)) text else null
    }

    // Writes the candidate to the temporary file, syncs it and renames it over the file. Any failure gives null and
    // leaves no temporary file.
    private fun store(candidate: String): String? {
        val temporary = File(directory, TEMPORARY_NAME)
        var stored = false
        try {
            FileOutputStream(temporary, false).use { output ->
                output.write(candidate.toByteArray(Charsets.US_ASCII))
                output.flush()
                output.fd.sync()
            }
            stored = temporary.renameTo(File(directory, FILE_NAME))
            return if (stored) candidate else null
        } finally {
            if (!stored) temporary.delete()
        }
    }

    companion object {
        const val FILE_NAME = "octave-install-id"
        const val TEMPORARY_NAME = "octave-install-id.tmp"
        private const val MAX_READ = 64
        private val UUID_V4 = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

        // One process-wide lock, so two calls cannot both store.
        private val LOCK = Any()

        fun isInstallId(text: String): Boolean = UUID_V4.matches(text)
    }
}
