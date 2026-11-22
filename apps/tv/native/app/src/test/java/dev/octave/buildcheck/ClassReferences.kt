package dev.octave.buildcheck

import java.io.ByteArrayInputStream
import java.io.DataInputStream

// A member a class refers to: a field or method of `owner`, in the JVM's internal form (`java/net/URL`).
data class MemberRef(val owner: String, val name: String, val descriptor: String)

// What one class file refers to, read from its constant pool: its own name, the classes and members it names, and
// every UTF-8 constant (descriptors, signatures, Kotlin metadata and string literals included).
data class ClassRefs(
    val name: String,
    val classes: Set<String>,
    val members: List<MemberRef>,
    val utf8: Set<String>,
)

// Reads a class file's constant pool (JVM specification, section 4.4). No dependency: the format is fixed.
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
        return ClassRefs(className(thisClass), classes, members, utf8.filterNotNull().toSet())
    }
}
