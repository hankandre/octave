package dev.octave.player

import dev.octave.player.seam.PlayerSeam
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The player module (T8-01): the PlayerEngine port's six commands, its one event, playerEvent (the port's
// subscribe), and one view with no prop. Its surface is held by surface-allowlist.json, docs/security.md and
// scripts/tv-module-surfaces.test.ts. Each command takes at most one map and resolves one map (PlayerSeam); none
// rejects on purpose.
//
// No engine is behind the seam until T8-02, so initialize answers "cannot tell" and a launch unsupported-request.
//
// Threading: each body hands the call to CommandQueue, this module's own single thread, and returns, so a command
// never holds Expo's shared modules queue and commands run in the order they came. A command still queued when the
// module is destroyed answers `unknown`. An engine marshals to the thread its player needs.
class OctavePlayerModule : Module() {
    private val commands = CommandQueue()
    private val seam = PlayerSeam(null, RegistrySessionCheck) { event -> sendEvent("playerEvent", event) }

    override fun definition() = ModuleDefinition {
        Name("OctavePlayer")

        Events("playerEvent")

        AsyncFunction("initialize") { promise: Promise -> run(promise) { seam.initialize() } }

        AsyncFunction("launch") { args: Map<String, Any?>, promise: Promise -> run(promise) { seam.launch(args) } }

        AsyncFunction("setPaused") { args: Map<String, Any?>, promise: Promise -> run(promise) { seam.setPaused(args) } }

        AsyncFunction("seek") { args: Map<String, Any?>, promise: Promise -> run(promise) { seam.seek(args) } }

        AsyncFunction("selectTrack") { args: Map<String, Any?>, promise: Promise -> run(promise) { seam.selectTrack(args) } }

        AsyncFunction("stop") { promise: Promise -> run(promise) { seam.stop() } }

        View(OctavePlayerView::class) {}

        OnDestroy {
            commands.close()
        }
    }

    private fun run(promise: Promise, call: () -> Map<String, Any?>) = commands.run({ promise.resolve(it) }, call)
}
