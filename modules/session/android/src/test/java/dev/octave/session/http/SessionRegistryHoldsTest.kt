package dev.octave.session.http

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.lang.reflect.Modifier

// T8-01 acceptance item 3, the session half (docs/specs/T8-01.md, D5): SessionRegistry.holds(session) is the one
// public answer the registry gives another module, a boolean: false for an id no sign-in opened, true while the
// session is open, false after close and after take. It returns no entry, origin or header.
class SessionRegistryHoldsTest {
    private val origin = "http://127.0.0.1:8096"

    @Test
    fun an_id_no_session_opened_is_not_held() {
        val parsed = SessionId.parse("0123456789abcdef0123456789abcdef")!!
        assertFalse(SessionRegistry.holds(parsed), "a parsed id grants nothing")
    }

    @Test
    fun an_open_session_is_held_until_it_is_closed() {
        val session = SessionRegistry.open(origin, TestSupport.authorization())
        try {
            assertTrue(SessionRegistry.holds(session), "held while open")
            assertTrue(SessionRegistry.holds(SessionId.parse(session.value)!!), "held by its id, not by the instance")
        } finally {
            SessionRegistry.close(session)
        }
        assertFalse(SessionRegistry.holds(session), "not held after close")
    }

    @Test
    fun a_taken_session_is_not_held() {
        val session = SessionRegistry.open(origin, TestSupport.authorization())
        val other = SessionRegistry.open(origin, TestSupport.authorization())
        try {
            SessionRegistry.take(session)
            assertFalse(SessionRegistry.holds(session), "not held after take")
            assertTrue(SessionRegistry.holds(other), "another session is still held")
        } finally {
            SessionRegistry.close(session)
            SessionRegistry.close(other)
        }
    }

    @Test
    fun holds_is_public_and_answers_a_boolean_only() {
        val method = SessionRegistry::class.java.getMethod("holds", SessionId::class.java)
        assertTrue(Modifier.isPublic(method.modifiers), "holds is public")
        assertEquals(java.lang.Boolean.TYPE, method.returnType, "holds answers a boolean")
    }
}
