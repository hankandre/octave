package dev.octave.session.store

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import dev.octave.session.http.RecordCipher
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// The stored credential's cipher on the device (decision 0005; docs/specs/T4-05.md, D2): AES-256-GCM under the key
// `octave.session.v1` in the Android Keystore, for encryption and decryption only, with no user authentication and no
// StrongBox. The Keystore makes each IV (randomized encryption stays required). The key material never enters the app.
//
// A key is generated only when the alias is positively absent from a Keystore that loaded, never after a failure, so a
// Keystore that is briefly unavailable never costs a record its key. It sees plaintext bytes only: never a header or a
// session id. Nothing here logs, and no answer carries a message.
internal class KeystoreCipher : RecordCipher {
    override fun seal(plain: ByteArray, associated: ByteArray): RecordCipher.Sealed {
        val key = when (val found = key()) {
            is Found.Key -> found.key
            Found.Absent -> generate() ?: return RecordCipher.Sealed.Unavailable
            Found.Unavailable -> return RecordCipher.Sealed.Unavailable
        }
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key)
            cipher.updateAAD(associated)
            val sealed = cipher.doFinal(plain)
            val iv = cipher.iv
            if (iv == null || iv.size != IV_BYTES) RecordCipher.Sealed.Unavailable else RecordCipher.Sealed.Bytes(iv + sealed)
        } catch (_: Exception) {
            RecordCipher.Sealed.Unavailable
        }
    }

    override fun open(sealed: ByteArray, associated: ByteArray): RecordCipher.Opened {
        if (sealed.size < IV_BYTES + TAG_BYTES) return RecordCipher.Opened.Corrupt
        val key = when (val found = key()) {
            is Found.Key -> found.key
            Found.Absent -> return RecordCipher.Opened.Corrupt
            Found.Unavailable -> return RecordCipher.Opened.Unavailable
        }
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BYTES * 8, sealed, 0, IV_BYTES))
            cipher.updateAAD(associated)
            RecordCipher.Opened.Plain(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES))
        } catch (_: AEADBadTagException) {
            RecordCipher.Opened.Corrupt
        } catch (_: Exception) {
            RecordCipher.Opened.Unavailable
        }
    }

    override fun toString(): String = "KeystoreCipher([redacted])"

    private sealed interface Found {
        class Key(val key: SecretKey) : Found

        object Absent : Found

        object Unavailable : Found
    }

    private fun key(): Found = try {
        val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
        when {
            !store.containsAlias(ALIAS) -> Found.Absent
            else -> (store.getKey(ALIAS, null) as? SecretKey)?.let { Found.Key(it) } ?: Found.Unavailable
        }
    } catch (_: Exception) {
        Found.Unavailable
    }

    private fun generate(): SecretKey? = try {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(KEY_BITS)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(false)
            .build()
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).apply { init(spec) }.generateKey()
    } catch (_: Exception) {
        null
    }

    companion object {
        const val ALIAS = "octave.session.v1"
        const val PROVIDER = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val KEY_BITS = 256
        private const val IV_BYTES = 12
        private const val TAG_BYTES = 16
    }
}
