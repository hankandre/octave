package dev.octave.artwork

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The artwork module (T3-11; decision 0005, amendment T3-11): one view whose only props are the session id, the item
// id, the image type, the tag and the drawn width, and whose only event is onArtworkState with a fixed word. No URL,
// header or token prop, no function, no module event. Its surface is held by surface-allowlist.json, docs/security.md,
// ModuleSurfaceTest and scripts/tv-artwork-module.test.ts.
class OctaveArtworkModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("OctaveArtwork")

        View(OctaveArtworkView::class) {
            Events("onArtworkState")

            Prop("session") { view: OctaveArtworkView, value: String? -> view.session = value }

            Prop("itemId") { view: OctaveArtworkView, value: String? -> view.itemId = value }

            Prop("imageType") { view: OctaveArtworkView, value: String? -> view.imageType = value }

            Prop("tag") { view: OctaveArtworkView, value: String? -> view.tag = value }

            Prop("width") { view: OctaveArtworkView, value: Double? -> view.drawnWidth = value }

            OnViewDidUpdateProps { view: OctaveArtworkView -> view.propsUpdated() }

            OnViewDestroys { view: OctaveArtworkView -> view.destroy() }
        }
    }
}
