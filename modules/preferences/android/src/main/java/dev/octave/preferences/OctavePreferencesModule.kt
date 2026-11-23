package dev.octave.preferences

import dev.octave.preferences.store.PreferencesStore
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

// The preferences module (T9-02): two functions, read() and write(record), which keep the device's one preferences
// record in the app's no-backup directory. It is not a key-value store: the store accepts and answers only the device
// record's shape (PreferencesStore.isAllowedRecord). The record is not a secret, and nothing here logs it.
//
// Threading: as in OctaveInstallIdModule, the body only hands the call to this module's IO scope, so file IO never
// holds Expo's shared modules queue; the coroutine resolves the promise.
class OctavePreferencesModule : Module() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun store(): PreferencesStore? = appContext.reactContext?.let { PreferencesStore(it.noBackupFilesDir) }

    override fun definition() = ModuleDefinition {
        Name("OctavePreferences")

        AsyncFunction("read") { promise: Promise ->
            scope.launch {
                val record = try {
                    store()?.read()
                } catch (_: Throwable) {
                    null
                }
                promise.resolve(record)
            }
        }

        AsyncFunction("write") { record: String, promise: Promise ->
            scope.launch {
                val written = try {
                    store()?.write(record) ?: false
                } catch (_: Throwable) {
                    false
                }
                promise.resolve(written)
            }
        }

        OnDestroy { scope.cancel() }
    }
}
