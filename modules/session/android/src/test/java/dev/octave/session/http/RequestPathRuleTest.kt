package dev.octave.session.http

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

// T3-16: the path rule's decisions beyond the shared vectors of packages/core/tests/fixtures/request-paths.json, held
// the same way by packages/core/src/adapters/request-path.test.ts.
class RequestPathRuleTest {
    @ParameterizedTest
    @ValueSource(strings = ["/Items/%ed%a0%80", "/Items/%f4%90%80%80", "/Items/%80", "/Items/a\u007fb", "/Items/%2525252e%2525252e/x"])
    fun refused(path: String) {
        assertFalse(RequestPath.isSafe(path), path)
    }

    @ParameterizedTest
    @ValueSource(strings = ["/Items/100%25", "/Items/%e2%82%ac", "/Items//x", "/Items/"])
    fun accepted(path: String) {
        assertTrue(RequestPath.isSafe(path), path)
    }
}
