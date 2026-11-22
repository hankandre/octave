package dev.octave.installid

import dev.octave.installid.store.InstallIdStore
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

// The install id module (T4-09): one function, keep(candidate), which answers the id kept in the app's no-backup
// directory, storing the candidate when none is kept. It is not a key-value store: the store accepts and answers only a
// lowercase version 4 UUID. The id is not a secret, and nothing here logs it.
//
// Threading: as in OctaveSessionModule, the body only hands the call to this module's IO scope, so file IO never holds
// Expo's shared modules queue; the coroutine resolves the promise.
class OctaveInstallIdModule : Module() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun definition() = ModuleDefinition {
        Name("OctaveInstallId")

        AsyncFunction("keep") { candidate: String, promise: Promise ->
            scope.launch {
                val kept = try {
                    val context = appContext.reactContext
                    if (context == null) null else InstallIdStore(context.noBackupFilesDir).keep(candidate)
                } catch (_: Throwable) {
                    null
                }
                promise.resolve(kept)
            }
        }

        OnDestroy { scope.cancel() }
    }
}
