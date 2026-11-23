package dev.octave.player

import dev.octave.player.media3.Media3Engine
import dev.octave.player.seam.PlayerSeam
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The player module (T8-01): the PlayerEngine port's six commands, its one event, playerEvent (the port's
// subscribe), and one view with no prop. Its surface is held by surface-allowlist.json, docs/security.md and
// scripts/tv-module-surfaces.test.ts. Each command takes at most one map and resolves one map (PlayerSeam); none
// rejects on purpose.
//
// The engine behind the seam is Media3Engine (T8-02); it reads the app's context at its first launch, so the module
// needs no OnCreate.
//
// Threading: each body hands the call to CommandQueue, this module's own single thread, and returns, so a command
// never holds Expo's shared modules queue and commands run in the order they came. A command still queued when the
// module is destroyed answers `unknown`. The engine marshals to the main thread its player needs; on destroy the
// module is marked destroyed, so the engine refuses any launch still on its way to the main thread, and the engine is
// stopped, inline when Expo calls OnDestroy on the main thread.
class OctavePlayerModule : Module() {
    @Volatile
    private var destroyed = false
    private val commands = CommandQueue()
    private val seam = PlayerSeam(Media3Engine(context = { appContext.reactContext?.applicationContext }, closed = { destroyed }), RegistrySessionCheck) { event ->
        sendEvent("playerEvent", event)
    }

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
            destroyed = true
            seam.stop()
            commands.close()
        }
    }

    private fun run(promise: Promise, call: () -> Map<String, Any?>) = commands.run({ promise.resolve(it) }, call)
}
