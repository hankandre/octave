package dev.octave.buildcheck

import java.io.ByteArrayInputStream
import java.io.DataInputStream

// A member a class refers to: a field or method of `owner`, in the JVM's internal form (`java/net/URL`).
data class MemberRef(val owner: String, val name: String, val descriptor: String)

// An instruction of the class's code that names a class by its constant: `new`, `anewarray`, `checkcast`, `instanceof`,
// `multianewarray` or an `ldc` of a class literal. `type` is the internal name (an array type as its descriptor).
data class TypeOperand(val opcode: String, val type: String)

// What one class file refers to, read from its constant pool: its own name, the classes and members it names, and
// every UTF-8 constant (descriptors, signatures, Kotlin metadata and string literals included). T8-02 adds what K7's
// one exception needs to tell a constructor call from any other use of a class: the class-naming instructions of its
// code, its superclass and interfaces, and its InnerClasses entries (inner class to outer class).
data class ClassRefs(
    val name: String,
    val classes: Set<String>,
    val members: List<MemberRef>,
    val utf8: Set<String>,
    val typeOperands: List<TypeOperand> = emptyList(),
    val supertypes: Set<String> = emptySet(),
    val nests: Map<String, String> = emptyMap(),
)

// Reads a class file (JVM specification, sections 4.1, 4.4, 4.7.3, 4.7.6 and 6.5). No dependency: the format is fixed.
object ClassReferences {
    private const val MAGIC = 0xCAFEBABE.toInt()

    fun read(bytes: ByteArray): ClassRefs {
        val input = DataInputStream(ByteArrayInputStream(bytes))
        require(input.readInt() == MAGIC) { "not a class file" }
        input.readUnsignedShort() // minor
        input.readUnsignedShort() // major
        val count = input.readUnsignedShort()
        val utf8 = arrayOfNulls<String>(count)
        val classIndex = IntArray(count)
        val refs = mutableListOf<Pair<Int, Int>>() // (class index, name-and-type index)
        val nameAndType = HashMap<Int, Pair<Int, Int>>()
        var index = 1
        while (index < count) {
            when (val tag = input.readUnsignedByte()) {
                1 -> utf8[index] = input.readUTF()
                3, 4 -> input.readInt()
                5, 6 -> {
                    input.readLong()
                    index += 1 // a long or double takes two slots
                }
                7 -> classIndex[index] = input.readUnsignedShort()
                8, 16, 19, 20 -> input.readUnsignedShort()
                9, 10, 11 -> refs += input.readUnsignedShort() to input.readUnsignedShort()
                12 -> nameAndType[index] = input.readUnsignedShort() to input.readUnsignedShort()
                15 -> {
                    input.readUnsignedByte()
                    input.readUnsignedShort()
                }
                17, 18 -> {
                    input.readUnsignedShort()
                    input.readUnsignedShort()
                }
                else -> error("unknown constant pool tag $tag at $index")
            }
            index += 1
        }
        input.readUnsignedShort() // access flags
        val thisClass = input.readUnsignedShort()
        val className = { i: Int -> checkNotNull(utf8[classIndex[i]]) { "class entry $i has no name" } }
        val classes = (1 until count).filter { classIndex[it] != 0 }.map(className).toSet()
        val members = refs.map { (owner, nat) ->
            val (name, descriptor) = checkNotNull(nameAndType[nat]) { "member has no name and type" }
            MemberRef(className(owner), checkNotNull(utf8[name]), checkNotNull(utf8[descriptor]))
        }

        val supertypes = mutableSetOf<String>()
        val superClass = input.readUnsignedShort()
        if (superClass != 0) supertypes += className(superClass)
        repeat(input.readUnsignedShort()) { supertypes += className(input.readUnsignedShort()) }

        val classAt = { i: Int -> if (i in 1 until count && classIndex[i] != 0) className(i) else null }
        val operands = mutableListOf<TypeOperand>()
        val nests = mutableMapOf<String, String>()
        repeat(input.readUnsignedShort()) { readMember(input, utf8, null) } // fields
        repeat(input.readUnsignedShort()) { readMember(input, utf8) { code -> operands += typeOperands(code, classAt) } } // methods
        repeat(input.readUnsignedShort()) {
            val name = utf8[input.readUnsignedShort()]
            val length = input.readInt()
            if (name == "InnerClasses") {
                repeat(input.readUnsignedShort()) {
                    val inner = input.readUnsignedShort()
                    val outer = input.readUnsignedShort()
                    input.readUnsignedShort() // inner name
                    input.readUnsignedShort() // flags
                    if (inner != 0 && outer != 0) nests[className(inner)] = className(outer)
                }
            } else {
                input.skipNBytes(length.toLong())
            }
        }
        return ClassRefs(className(thisClass), classes, members, utf8.filterNotNull().toSet(), operands, supertypes, nests)
    }

    // One field or method (section 4.5, 4.6); `onCode` receives a method's Code attribute.
    private fun readMember(input: DataInputStream, utf8: Array<String?>, onCode: ((ByteArray) -> Unit)?) {
        input.readUnsignedShort() // access flags
        input.readUnsignedShort() // name
        input.readUnsignedShort() // descriptor
        repeat(input.readUnsignedShort()) {
            val name = utf8[input.readUnsignedShort()]
            val length = input.readInt()
            if (name == "Code" && onCode != null) {
                val body = ByteArray(length)
                input.readFully(body)
                onCode(body)
            } else {
                input.skipNBytes(length.toLong())
            }
        }
    }

    // The class-naming instructions of one Code attribute (section 4.7.3), walked by instruction length (section 6.5).
    private fun typeOperands(body: ByteArray, classAt: (Int) -> String?): List<TypeOperand> {
        val input = DataInputStream(ByteArrayInputStream(body))
        input.readUnsignedShort() // max stack
        input.readUnsignedShort() // max locals
        val code = ByteArray(input.readInt())
        input.readFully(code)
        val u1 = { at: Int -> code[at].toInt() and 0xFF }
        val u2 = { at: Int -> (u1(at) shl 8) or u1(at + 1) }
        val s4 = { at: Int -> (u2(at) shl 16) or u2(at + 2) }
        val out = mutableListOf<TypeOperand>()
        var pc = 0
        while (pc < code.size) {
            val op = u1(pc)
            val named = when (op) {
                0x12 -> "ldc" to u1(pc + 1)
                0x13 -> "ldc_w" to u2(pc + 1)
                0xbb -> "new" to u2(pc + 1)
                0xbd -> "anewarray" to u2(pc + 1)
                0xc0 -> "checkcast" to u2(pc + 1)
                0xc1 -> "instanceof" to u2(pc + 1)
                0xc5 -> "multianewarray" to u2(pc + 1)
                else -> null
            }
            if (named != null) classAt(named.second)?.let { out += TypeOperand(named.first, it) }
            pc += when (op) {
                0x10, 0x12, 0xa9, 0xbc, in 0x15..0x19, in 0x36..0x3a -> 2
                0x11, 0x13, 0x14, 0x84, in 0x99..0xa8, in 0xb2..0xb8, 0xbb, 0xbd, 0xc0, 0xc1, 0xc6, 0xc7 -> 3
                0xc5 -> 4
                0xb9, 0xba, 0xc8, 0xc9 -> 5
                0xc4 -> if (u1(pc + 1) == 0x84) 6 else 4
                0xaa -> {
                    val at = (pc + 4) and 3.inv()
                    at - pc + 12 + (s4(at + 8) - s4(at + 4) + 1) * 4
                }
                0xab -> {
                    val at = (pc + 4) and 3.inv()
                    at - pc + 8 + s4(at + 4) * 8
                }
                else -> 1
            }
        }
        return out
    }
}
