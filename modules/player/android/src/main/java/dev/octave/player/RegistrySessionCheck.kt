package dev.octave.player

import dev.octave.player.seam.SessionCheck
import dev.octave.session.http.SessionId

// The seam's session check in the app: the session registry's one answer to another module, held or not (T8-01,
// decision 0005). The player module gets no other part of a session. The registry is named in full at its one use,
// so `SessionRegistry.holds` is the only reference to it in the module (SessionAuthorityTest).
object RegistrySessionCheck : SessionCheck {
    override fun holds(session: SessionId): Boolean = dev.octave.session.http.SessionRegistry.holds(session)
}
