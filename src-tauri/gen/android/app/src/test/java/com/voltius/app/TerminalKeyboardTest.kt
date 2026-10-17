package com.voltius.app

import android.text.InputType
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Android framework-level contract tests, not an OEM keyboard/device test. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35], manifest = Config.NONE)
class TerminalKeyboardTest {
  private lateinit var connection: TerminalInputConnection
  private val text = mutableListOf<String>()
  private val keys = mutableListOf<String>()

  @Before fun setUp() {
    text.clear()
    keys.clear()
    val view = TerminalInputView(RuntimeEnvironment.getApplication())
    connection = TerminalInputConnection(view, { text.add(it) }, { keys.add(it) })
  }

  @Test fun ordinaryTerminalDoesNotAdvertisePasswordOrSuppressCandidates() {
    val attrs = EditorInfo()
    TerminalInputView(RuntimeEnvironment.getApplication()).onCreateInputConnection(attrs)
    assertEquals(InputType.TYPE_CLASS_TEXT, attrs.inputType and InputType.TYPE_MASK_CLASS)
    assertEquals(InputType.TYPE_TEXT_VARIATION_NORMAL, attrs.inputType and InputType.TYPE_MASK_VARIATION)
    assertEquals(0, attrs.inputType and InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
    assertEquals(0, attrs.inputType and InputType.TYPE_TEXT_FLAG_AUTO_CORRECT)
    assertTrue(attrs.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0)
  }

  @Test fun chineseCandidateReplacesPinyinWithoutSendingPreeditOrBackspaces() {
    for (preedit in listOf("n", "ni", "nih", "nihao", "nihao")) {
      assertTrue(connection.setComposingText(preedit, 1))
    }
    assertEquals("nihao", connection.getTextBeforeCursor(100, 0).toString())
    assertTrue(text.isEmpty())
    assertTrue(keys.isEmpty())
    assertTrue(connection.commitText("你好", 1))
    assertTrue(connection.finishComposingText())
    assertEquals(listOf("你好"), text)
    assertTrue(keys.isEmpty())
    assertEquals("", connection.getTextBeforeCursor(100, 0).toString())
  }

  @Test fun englishCommitsRemainOrderedAndRepeatedLettersAreNotDeduplicated() {
    for (part in listOf("l", "s", " ", "oo")) connection.commitText(part, 1)
    connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
    connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
    assertEquals(listOf("l", "s", " ", "oo"), text)
    assertEquals(listOf("Enter"), keys)
  }

  @Test fun shrinkingAndCancellingCompositionDoesNotDeleteRemoteText() {
    connection.commitText("echo ", 1)
    connection.setComposingText("nihao", 1)
    connection.setComposingText("ni", 1)
    connection.setComposingText("", 1)
    connection.finishComposingText()
    assertEquals(listOf("echo "), text)
    assertTrue(keys.isEmpty())
  }

  @Test fun finishCommitsPendingTextOnlyOnceAndCodePointsSurvive() {
    connection.setComposingText("𠮷🙂", 1)
    connection.finishComposingText()
    connection.finishComposingText()
    connection.commitText("世界", 1)
    assertEquals(listOf("𠮷🙂", "世界"), text)
  }

  @Test fun selectionAndComposingRegionUseAndroidReplacementSemantics() {
    connection.setComposingText("nihao", 1)
    connection.setComposingRegion(0, 5)
    connection.setSelection(2, 2)
    assertEquals("ni", connection.getTextBeforeCursor(100, 0).toString())
    assertEquals("hao", connection.getTextAfterCursor(100, 0).toString())
    connection.commitText("你好", 1)
    assertEquals(listOf("你好"), text)
  }

  @Test fun hardwareBackspaceDuringPreeditDeletesOneCodePointLocally() {
    connection.setComposingText("你🙂", 1)
    connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DEL))
    connection.finishComposingText()
    assertEquals(listOf("你"), text)
    assertTrue(keys.isEmpty())
  }

  @Test fun surroundingDeletionOnAnEmptyBufferReachesTheTerminal() {
    connection.deleteSurroundingText(1, 1)
    connection.deleteSurroundingTextInCodePoints(1, 0)
    assertEquals(listOf("Backspace", "Delete", "Backspace"), keys)
  }

  @Test fun closedConnectionCancelsPreeditAndRejectsLateImeInput() {
    connection.setComposingText("nihao", 1)
    connection.closeConnection()
    assertFalse(connection.commitText("你好", 1))
    assertFalse(connection.finishComposingText())
    assertFalse(connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER)))
    assertTrue(text.isEmpty())
    assertTrue(keys.isEmpty())
  }
}
