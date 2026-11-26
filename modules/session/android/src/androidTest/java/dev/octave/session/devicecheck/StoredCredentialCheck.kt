package dev.octave.session.devicecheck

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import dev.octave.session.http.ClientIdentity
import dev.octave.session.http.DevelopmentServers
import dev.octave.session.http.SessionId
import dev.octave.session.http.SessionRegistry
import dev.octave.session.http.SessionStore
import dev.octave.session.http.SessionTransport
import dev.octave.session.http.StoredSession
import dev.octave.session.store.KeystoreCipher
import dev.octave.session.store.SessionStores
import java.io.File
import java.net.URLEncoder
import java.security.KeyStore
import java.util.Base64
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory

// T4-05's device check (docs/specs/T4-05.md, "The device proof"), run by CleartextProbe with -e check
// stored-credential-save, then, in a new instrumentation run and so a new process, -e check stored-credential-restore
// (scripts/tv-stored-credential.mjs). It builds the store through SessionStores.of, the factory the module uses, over
// the real Android Keystore and this APK's no-backup directory. Save: one record with a made-up canary token, the key's
// KeyInfo, where the record lives, and every file of this APK's data directory read for the canary. Restore: the record
// is listed by a new transport, the canary is in no result and no file, and once the key is deleted the record reads as
// corrupt and is deleted. It reports fixed words and counts only, never a token, a path or an exception message, and
// logs nothing. Nothing here sends a request.
internal class StoredCredentialCheck(private val context: Context) {
    private val store: SessionStore = SessionStores.of(context)
    private val dataDir = File(context.applicationInfo.dataDir)

    fun save(results: Bundle) {
        // A fresh start: no record and no key, so the save below makes the key.
        clean()
        section(results, "key-before") {
            val keys = KeyStore.getInstance(KeystoreCipher.PROVIDER).apply { load(null) }
            keys.deleteEntry(KeystoreCipher.ALIAS)
            if (keys.containsAlias(KeystoreCipher.ALIAS)) "kept" else "absent"
        }
        val file = store.save(StoredSession(SERVER, DEVICE_ID, CANARY, USER_ID, SERVER_ID, USER_NAME))
        results.putString("saved", if (file != null && file.isFile) "yes" else "no")
        section(results, "record-dir") {
            val noBackup = context.noBackupFilesDir.canonicalPath + File.separator
            if (file != null && file.canonicalPath.startsWith(noBackup)) "no-backup" else "elsewhere"
        }
        keyFacts(results)
        scan(results)
        results.putString("done", "yes")
    }

    fun restore(results: Bundle) {
        val transport = SessionTransport(ClientIdentity.of(Build.MODEL, "0.0.0"), DevelopmentServers.forBuild(true, ""), store)
        val first = transport.restore()
        val mine = sessions(first).filter { it["userId"] == USER_ID }
        results.putString("listed", mine.size.toString())
        results.putString("result-canary", if (forms().any { first.toString().contains(it) }) "found" else "absent")
        scan(results)

        // The key goes; the record must read as corrupt and be deleted, and nothing may be listed for it.
        mine.mapNotNull { (it["session"] as? String)?.let(SessionId::parse) }.forEach { SessionRegistry.close(it) }
        section(results, "key-deleted") {
            KeyStore.getInstance(KeystoreCipher.PROVIDER).apply { load(null) }.deleteEntry(KeystoreCipher.ALIAS)
            "yes"
        }
        val second = sessions(transport.restore()).filter { it["userId"] == USER_ID }
        second.mapNotNull { (it["session"] as? String)?.let(SessionId::parse) }.forEach { SessionRegistry.close(it) }
        results.putString("listed-after-key-deleted", second.size.toString())
        results.putString("record-after-key-deleted", if (store.fileFor(SERVER_ID, USER_ID).exists()) "kept" else "gone")
        clean()
        results.putString("done", "yes")
    }

    private fun keyFacts(results: Bundle) {
        val key = try {
            KeyStore.getInstance(KeystoreCipher.PROVIDER).apply { load(null) }.getKey(KeystoreCipher.ALIAS, null) as? SecretKey
        } catch (error: Exception) {
            results.putString("key-origin", "failed-${error.javaClass.simpleName}")
            return
        }
        if (key == null) {
            results.putString("key-origin", "absent")
            return
        }
        section(results, "key-origin") {
            val info = SecretKeyFactory.getInstance(key.algorithm, KeystoreCipher.PROVIDER).getKeySpec(key, KeyInfo::class.java) as KeyInfo
            results.putString("key-size", info.keySize.toString())
            results.putString("key-auth", if (info.isUserAuthenticationRequired) "required" else "none")
            results.putString("key-algorithm", key.algorithm)
            if (info.origin == KeyProperties.ORIGIN_GENERATED) "generated" else "other-${info.origin}"
        }
    }

    // Reads every file under this APK's data directory for the canary in any form; first a planted file proves the
    // scan finds it.
    private fun scan(results: Bundle) {
        val planted = File(context.cacheDir, "octave-probe-selftest")
        val selftest = try {
            planted.writeText("before $CANARY after")
            if (holders(listOf(planted)).isNotEmpty()) "ok" else "missed"
        } catch (error: Exception) {
            "failed-${error.javaClass.simpleName}"
        } finally {
            planted.delete()
        }
        results.putString("selftest", selftest)
        val files = dataDir.walkTopDown().filter { it.isFile }.toList()
        var unreadable = 0
        val found = files.count { file ->
            try {
                holders(listOf(file)).isNotEmpty()
            } catch (_: Exception) {
                unreadable += 1
                false
            }
        }
        results.putString("files-read", (files.size - unreadable).toString())
        results.putString("unreadable", unreadable.toString())
        results.putString("canary", if (found == 0) "absent" else "found-$found")
    }

    private fun holders(files: List<File>): List<File> = files.filter { file ->
        val text = String(file.readBytes(), Charsets.ISO_8859_1)
        forms().any { text.contains(it) }
    }

    // The canary raw, percent-encoded, hex in both cases and base64 at every alignment, as the JVM canary test reads.
    private fun forms(): List<String> {
        val bytes = CANARY.toByteArray(Charsets.UTF_8)
        val hex = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        val found = mutableListOf(CANARY, URLEncoder.encode(CANARY, "UTF-8"), hex, hex.uppercase())
        for (encoder in listOf(Base64.getEncoder(), Base64.getUrlEncoder())) {
            for (shift in 0..2) {
                val text = encoder.withoutPadding().encodeToString(ByteArray(shift) { 0x41 } + bytes)
                val start = if (shift == 0) 0 else 4
                found += text.substring(start, text.length - 4)
            }
        }
        return found.distinct()
    }

    @Suppress("UNCHECKED_CAST")
    private fun sessions(result: Map<String, Any?>): List<Map<String, Any?>> = (result["sessions"] as? List<Map<String, Any?>>).orEmpty()

    private fun clean() {
        store.dir.listFiles()?.forEach { it.delete() }
        store.dir.delete()
    }

    private fun section(results: Bundle, key: String, run: () -> String) {
        val value = try {
            run()
        } catch (error: Exception) {
            "failed-${error.javaClass.simpleName}"
        }
        results.putString(key, value)
    }

    private companion object {
        // Made up: no real token, server, user or device. 10.0.2.2 is the emulator's host; nothing is sent to it.
        const val CANARY = "CANARYt405probe5a6b7c8d9e0f1a2b3c4d"
        const val SERVER = "http://10.0.2.2:8096"
        const val DEVICE_ID = "stored-credential-probe"
        const val USER_ID = "probe-user-t405"
        const val SERVER_ID = "0123456789abcdef0123456789abcdef"
        const val USER_NAME = "Probe Viewer"
    }
}
