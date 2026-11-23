package dev.octave.preferences.store

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException

// The interface a Swift implementation mirrors (T9-02).
interface PreferencesKeeper {
    // The stored record, or null when none is stored, it cannot be read, or it is not an allowed record.
    fun read(): String?

    // Stores the record and answers true; answers false, writing nothing, when the record is not allowed or the store
    // cannot be written.
    fun write(record: String): Boolean
}

// One file, `octave-preferences.json`, in the directory it is given (the app's no-backup directory). It holds the
// device's preferences record and nothing else: text that is not an allowed record (isAllowedRecord) is refused on
// write and read as absent. Plain Kotlin, no Android class. Nothing is logged and no message leaves this class.
class PreferencesStore(private val directory: File) : PreferencesKeeper {
    override fun read(): String? {
        synchronized(LOCK) {
            return try {
                readFile()
            } catch (_: IOException) {
                null
            } catch (_: SecurityException) {
                null
            }
        }
    }

    override fun write(record: String): Boolean {
        if (!isAllowedRecord(record)) return false
        synchronized(LOCK) {
            return try {
                store(record)
            } catch (_: IOException) {
                false
            } catch (_: SecurityException) {
                false
            }
        }
    }

    private fun readFile(): String? {
        val file = File(directory, FILE_NAME)
        if (!file.isFile) return null
        // One byte more than allowed, so an over-long file is seen as over-long.
        val buffer = ByteArray(MAX_BYTES + 1)
        var length = 0
        FileInputStream(file).use { input ->
            while (length < buffer.size) {
                val count = input.read(buffer, length, buffer.size - length)
                if (count < 0) break
                length += count
            }
        }
        if (length > MAX_BYTES) return null
        val text = String(buffer, 0, length, Charsets.UTF_8)
        return if (isAllowedRecord(text)) text else null
    }

    // Writes the record to the temporary file, syncs it and renames it over the file. Any failure gives false and leaves
    // no temporary file.
    private fun store(record: String): Boolean {
        val temporary = File(directory, TEMPORARY_NAME)
        var stored = false
        try {
            FileOutputStream(temporary, false).use { output ->
                output.write(record.toByteArray(Charsets.UTF_8))
                output.flush()
                output.fd.sync()
            }
            stored = temporary.renameTo(File(directory, FILE_NAME))
            return stored
        } finally {
            if (!stored) temporary.delete()
        }
    }

    companion object {
        const val FILE_NAME = "octave-preferences.json"
        const val TEMPORARY_NAME = "octave-preferences.json.tmp"
        const val MAX_BYTES = 1024

        // The streaming limit choices of packages/core/src/streaming-limits.ts (STREAMING_LIMIT_CHOICES_MBPS). The
        // shared vectors in packages/core/tests/fixtures/preference-records.json fail this module's tests if they drift.
        private val LIMIT_CHOICES = setOf("120", "80", "40", "20", "10", "8", "4", "2")

        // One process-wide lock, so two writes cannot interleave and a read never sees a half-renamed file.
        private val LOCK = Any()

        // True only for the device record's shape, exactly as the core's encoder writes it (docs/specs/T9-02.md, D4):
        // {"version":1,"streamingLimits":{...}} in that order, and inside streamingLimits at most a "localMbps" and
        // then a "remoteMbps", each one of the limit choices. No whitespace, no escape, no other order, name, literal
        // or number. So the store holds no text but one of the 81 records the encoder writes.
        fun isAllowedRecord(text: String): Boolean {
            if (text.toByteArray(Charsets.UTF_8).size > MAX_BYTES) return false
            return RecordReader(text).record()
        }
    }

    // A reader for the one grammar above. Each method answers false at the first character that does not fit.
    private class RecordReader(private val text: String) {
        private var at = 0

        // {"version":1,"streamingLimits":<limits>} in that order.
        fun record(): Boolean {
            return take('{') && name() == "version" && take(':') && number() == "1" &&
                take(',') && name() == "streamingLimits" && take(':') && limits() &&
                take('}') && at == text.length
        }

        // {}, {"localMbps":n}, {"remoteMbps":n} or {"localMbps":n,"remoteMbps":n}, localMbps first, as the encoder
        // writes it.
        private fun limits(): Boolean {
            if (!take('{')) return false
            if (take('}')) return true
            var name = name() ?: return false
            if (name == "localMbps") {
                if (!limit()) return false
                if (take('}')) return true
                if (!take(',')) return false
                name = name() ?: return false
            }
            return name == "remoteMbps" && limit() && take('}')
        }

        private fun limit(): Boolean = take(':') && number() in LIMIT_CHOICES

        // A quoted name of ASCII letters only.
        private fun name(): String? {
            if (!take('"')) return null
            val start = at
            while (at < text.length && text[at].let { it in 'a'..'z' || it in 'A'..'Z' }) at += 1
            val name = text.substring(start, at)
            return if (name.isNotEmpty() && take('"')) name else null
        }

        // A run of ASCII digits; the caller compares it with the allowed values, so a leading zero or a sign fails.
        private fun number(): String? {
            val start = at
            while (at < text.length && text[at] in '0'..'9') at += 1
            return if (at > start) text.substring(start, at) else null
        }

        private fun take(c: Char): Boolean {
            if (at < text.length && text[at] == c) {
                at += 1
                return true
            }
            return false
        }
    }
}
