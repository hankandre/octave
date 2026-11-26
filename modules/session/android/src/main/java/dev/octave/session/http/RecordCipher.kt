package dev.octave.session.http

// The cipher a stored session record is sealed with (docs/specs/T4-05.md, D2). On the device it is KeystoreCipher
// (dev.octave.session.store), AES-256-GCM under a key held in the Android Keystore; the JVM tests supply their own.
// `seal` answers the 12-byte IV followed by the ciphertext and its 16-byte tag, and `open` takes the same bytes. The
// associated data is the record's file name. No answer carries a message.
internal interface RecordCipher {
    fun seal(plain: ByteArray, associated: ByteArray): Sealed

    fun open(sealed: ByteArray, associated: ByteArray): Opened

    sealed interface Sealed {
        class Bytes(val bytes: ByteArray) : Sealed {
            override fun toString(): String = "Sealed.Bytes([redacted])"
        }

        // The key or the provider failed; nothing may be written, and no key is replaced.
        object Unavailable : Sealed
    }

    sealed interface Opened {
        class Plain(val bytes: ByteArray) : Opened {
            override fun toString(): String = "Opened.Plain([redacted])"
        }

        // A failed tag, or the key positively absent from a Keystore that loaded: the record is deleted.
        object Corrupt : Opened

        // Any other Keystore or provider error: the record is kept and not opened.
        object Unavailable : Opened
    }
}
