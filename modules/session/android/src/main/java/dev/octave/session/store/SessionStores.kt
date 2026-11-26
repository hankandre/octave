package dev.octave.session.store

import android.content.Context
import dev.octave.session.http.SessionStore

// The one factory of the stored credential (docs/specs/T4-05.md, D3): records under the no-backup directory, which
// Auto Backup and device-to-device transfer never copy, sealed by the Keystore's key. OctaveSessionModule and the
// device probe both build the store here.
internal object SessionStores {
    fun of(context: Context): SessionStore = SessionStore(context.noBackupFilesDir, KeystoreCipher())
}
