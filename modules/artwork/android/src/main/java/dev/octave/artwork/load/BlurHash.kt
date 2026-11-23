package dev.octave.artwork.load

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sign

// The module's own BlurHash decoder (T3-39; docs/specs/T3-39.md, "The native decoder"). The algorithm follows the
// woltapp/blurhash reference (MIT, read at 712a47f9): no code of it is copied in. Plain Kotlin, so Swift can mirror it
// against packages/core/tests/fixtures/blurhash-vectors.json.
//
// decode answers SIZE x SIZE ARGB ints (alpha 255), row by row, or null for a refused hash. It validates before any
// arithmetic: 6 to MAX_LENGTH characters, every one in the 83-character alphabet, a length of 4 + 2 * numX * numY, a DC
// value of at most 0xFFFFFF and every AC value at most 19^3 - 1. It never throws.
object BlurHash {
    const val MAX_LENGTH = 166
    const val SIZE = 32

    private const val MIN_LENGTH = 6
    private const val MAX_DC = 0xFFFFFF
    private const val MAX_AC = 19 * 19 * 19 - 1
    private const val ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#\$%*+,-.:;=?@[]^_{|}~"

    private val digits = IntArray(128) { -1 }.also { table -> ALPHABET.forEachIndexed { index, c -> table[c.code] = index } }

    fun decode(hash: String): IntArray? = try {
        decodeValid(hash)
    } catch (_: Throwable) {
        null
    }

    private fun decodeValid(hash: String): IntArray? {
        if (hash.length < MIN_LENGTH || hash.length > MAX_LENGTH) return null
        val values = IntArray(hash.length)
        for (i in hash.indices) {
            val code = hash[i].code
            if (code >= digits.size || digits[code] < 0) return null
            values[i] = digits[code]
        }
        val flag = values[0]
        val numX = flag % 9 + 1
        val numY = flag / 9 + 1
        if (hash.length != 4 + 2 * numX * numY) return null

        val dc = number(values, 2, 4)
        if (dc > MAX_DC) return null
        val components = numX * numY
        val maximum = (values[1] + 1) / 166.0
        val colors = DoubleArray(components * 3)
        colors[0] = toLinear(dc shr 16 and 0xFF)
        colors[1] = toLinear(dc shr 8 and 0xFF)
        colors[2] = toLinear(dc and 0xFF)
        for (c in 1 until components) {
            val ac = number(values, 4 + c * 2, 2)
            if (ac > MAX_AC) return null
            colors[c * 3] = signedSquare((ac / (19 * 19)) - 9) * maximum
            colors[c * 3 + 1] = signedSquare((ac / 19) % 19 - 9) * maximum
            colors[c * 3 + 2] = signedSquare(ac % 19 - 9) * maximum
        }

        val cosX = DoubleArray(SIZE * numX) { k -> cos(PI * (k / numX) * (k % numX) / SIZE) }
        val cosY = DoubleArray(SIZE * numY) { k -> cos(PI * (k / numY) * (k % numY) / SIZE) }
        val pixels = IntArray(SIZE * SIZE)
        for (y in 0 until SIZE) {
            for (x in 0 until SIZE) {
                var r = 0.0
                var g = 0.0
                var b = 0.0
                for (j in 0 until numY) {
                    val basisY = cosY[y * numY + j]
                    for (i in 0 until numX) {
                        val basis = cosX[x * numX + i] * basisY
                        val c = (j * numX + i) * 3
                        r += colors[c] * basis
                        g += colors[c + 1] * basis
                        b += colors[c + 2] * basis
                    }
                }
                pixels[y * SIZE + x] = (0xFF shl 24) or (toSrgb(r) shl 16) or (toSrgb(g) shl 8) or toSrgb(b)
            }
        }
        return pixels
    }

    private fun number(values: IntArray, start: Int, length: Int): Int {
        var value = 0
        for (i in start until start + length) value = value * 83 + values[i]
        return value
    }

    // signPow((q - 9) / 9, 2) of the reference.
    private fun signedSquare(centred: Int): Double {
        val v = centred / 9.0
        return sign(v) * abs(v).pow(2.0)
    }

    private fun toLinear(channel: Int): Double {
        val v = channel / 255.0
        return if (v <= 0.04045) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
    }

    private fun toSrgb(linear: Double): Int {
        val v = linear.coerceIn(0.0, 1.0)
        val srgb = if (v <= 0.0031308) v * 12.92 else 1.055 * v.pow(1 / 2.4) - 0.055
        return (srgb * 255 + 0.5).toInt()
    }
}
