package dev.octave.player.engine

// What the view needs to know about the picture (docs/specs/T8-04.md, D12): whether it is playing, so the screen
// stays awake. Plain Kotlin, so a Swift engine can mirror it.
data class PictureState(val awake: Boolean)
