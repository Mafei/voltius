package com.voltius.app

import android.annotation.SuppressLint
import android.content.Context
import android.text.InputType
import android.text.Editable
import android.text.Selection
import android.text.SpannableStringBuilder
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import org.json.JSONObject

/**
 * Native soft-keyboard bridge for the xterm.js terminal.
 *
 * The WebView's own IME path corrupts terminal input on Android: Gboard-style IMEs send
 * composition, autocorrect and semantic edits that xterm's hidden textarea mishandles
 * (reordered/duplicated chars, deletes that reinsert composed text — issue #34). We can't
 * override the WebView's InputConnection (Wry's RustWebView is final and regenerated), so we
 * own the IME ourselves: a transparent, focusable overlay that becomes the sole input target,
 * advertises an ordinary text editor, and translates committed IME text into clean
 * terminal bytes forwarded to JS (`window.__voltiusTermInput` / `__voltiusTermKey`).
 *
 * Touches fall through to the WebView (see [TerminalInputView.onTouchEvent]) so xterm keeps
 * its native selection/scroll gestures.
 */
object TerminalKeyboard {
  private const val TAG = "TerminalKeyboard"
  private var inputView: TerminalInputView? = null
  private var webView: WebView? = null

  /** Called from MainActivity.onWebViewCreate once Wry has built the RustWebView. */
  fun install(activity: MainActivity, wv: WebView) {
    webView = wv
    wv.post {
      val parent = wv.parent as? ViewGroup
      if (parent == null) { Log.w(TAG, "install: webView has no ViewGroup parent"); return@post }
      // A 1x1 view: focusable enough to own the IME, but too small to intercept terminal touches.
      val view = TerminalInputView(activity)
      parent.addView(view, ViewGroup.LayoutParams(1, 1))
      inputView = view
    }
  }

  /** JS asked to raise the keyboard for the active terminal. Runs on the UI thread.
   *  While the terminal keyboard is up the WebView is made non-focusable so it can't win
   *  Android focus (and rebind the IME to xterm's textarea, which would restore Gboard's
   *  DOM composition path — issue #34). Touches still reach the WebView for
   *  selection/scroll; DOM focus (cursor) is unaffected. hide() restores focusability so the
   *  rest of the app's text inputs keep working. */
  @JvmStatic
  fun show() {
    val view = inputView
    if (view == null) { Log.w(TAG, "show: no input view yet"); return }
    view.post {
      webView?.let { it.clearFocus(); it.isFocusable = false; it.isFocusableInTouchMode = false }
      view.requestFocus()
      val imm = view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
      imm?.showSoftInput(view, InputMethodManager.SHOW_IMPLICIT)
    }
  }

  /** JS asked to dismiss the keyboard (terminal blurred / session closed). */
  @JvmStatic
  fun hide() {
    val view = inputView ?: return
    view.post {
      view.resetInput()
      val imm = view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
      imm?.hideSoftInputFromWindow(view.windowToken, 0)
      view.clearFocus()
      webView?.let { it.isFocusable = true; it.isFocusableInTouchMode = true }
    }
  }

  /** Forward a run of typed text to the active terminal. */
  fun feedText(text: String) {
    if (text.isEmpty()) return
    eval("window.__voltiusTermInput", text)
  }

  /** Forward a semantic key (Enter, Backspace, Delete, arrows, Home/End, Tab, Esc, PgUp/PgDn). */
  fun feedKey(name: String) {
    eval("window.__voltiusTermKey", name)
  }

  private fun eval(fn: String, arg: String) {
    val wv = webView ?: return
    val js = "if(typeof $fn==='function'){$fn(${JSONObject.quote(arg)});}"
    wv.post { wv.evaluateJavascript(js, null) }
  }
}

/**
 * Transparent overlay that owns the Android IME on behalf of the terminal. It reports itself as
 * an ordinary text editor. Only the current IME composition is buffered locally; confirmed
 * text is forwarded to the terminal. This is not a password field or a custom keyboard.
 */
@SuppressLint("ViewConstructor", "ClickableViewAccessibility")
class TerminalInputView(context: Context) : View(context) {
  private var connection: TerminalInputConnection? = null

  init {
    isFocusable = true
    isFocusableInTouchMode = true
    isClickable = false
    setWillNotDraw(true)
  }

  override fun onCheckIsTextEditor(): Boolean = true

  // Never consume touches: the WebView beneath keeps its selection/scroll gestures.
  override fun onTouchEvent(event: MotionEvent?): Boolean = false

  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
    resetInput()
    // A password variation can make OEMs replace the selected IME with a security keyboard.
    // Do not suppress candidates: Chinese/Japanese IMEs need composition to enter text.
    // Leave AUTO_CORRECT unset for commands, and keep the existing privacy/layout hints.
    outAttrs.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
    outAttrs.imeOptions = EditorInfo.IME_ACTION_NONE or
      EditorInfo.IME_FLAG_NO_EXTRACT_UI or
      EditorInfo.IME_FLAG_NO_FULLSCREEN or
      EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
    outAttrs.initialSelStart = 0
    outAttrs.initialSelEnd = 0
    return TerminalInputConnection(this).also { connection = it }
  }

  /** Focus/connection loss cancels unconfirmed text rather than sending it to another session. */
  internal fun resetInput() {
    connection?.closeConnection()
    connection = null
  }

  override fun onFocusChanged(gainFocus: Boolean, direction: Int, previouslyFocusedRect: android.graphics.Rect?) {
    super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
    if (!gainFocus) resetInput()
  }
}

/**
 * A full InputConnection for the pending composition, not a mirror of the remote shell line.
 * BaseInputConnection owns Android's composing spans, selection and surrounding-text queries.
 * Preedit must never reach the PTY: replacing pinyin with a candidate must not send a sequence
 * of guesses and Backspaces to a remote program. Only commit/finish emits text, exactly once.
 */
internal class TerminalInputConnection(
  private val view: View,
  private val emitText: (String) -> Unit = TerminalKeyboard::feedText,
  private val emitKey: (String) -> Unit = TerminalKeyboard::feedKey,
) : BaseInputConnection(view, true) {
  private val pending = SpannableStringBuilder().also { Selection.setSelection(it, 0) }
  private var batchDepth = 0
  private var closed = false

  override fun getEditable(): Editable = pending

  override fun beginBatchEdit(): Boolean {
    if (closed) return false
    batchDepth++
    return true
  }

  override fun endBatchEdit(): Boolean {
    if (batchDepth == 0) return false
    batchDepth--
    if (batchDepth == 0 && !closed) {
      val imm = view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
      imm?.updateSelection(view, Selection.getSelectionStart(pending), Selection.getSelectionEnd(pending),
        getComposingSpanStart(pending), getComposingSpanEnd(pending))
    }
    return batchDepth > 0
  }

  private inline fun edit(operation: () -> Boolean): Boolean {
    if (!beginBatchEdit()) return false
    return try { operation() } finally { endBatchEdit() }
  }

  private fun clearPending() {
    pending.clear()
    pending.clearSpans()
    Selection.setSelection(pending, 0)
  }

  private fun flushCommitted() {
    val text = pending.toString()
    clearPending()
    if (text.isNotEmpty()) emitText(text)
  }

  override fun setComposingText(text: CharSequence, newCursorPosition: Int): Boolean = edit {
    super.setComposingText(text, newCursorPosition)
  }

  override fun setComposingRegion(start: Int, end: Int): Boolean = edit {
    super.setComposingRegion(start, end)
  }

  override fun setSelection(start: Int, end: Int): Boolean = edit {
    super.setSelection(start, end)
  }

  override fun finishComposingText(): Boolean = edit {
    super.finishComposingText()
    flushCommitted()
    true
  }

  override fun commitText(text: CharSequence, newCursorPosition: Int): Boolean = edit {
    super.commitText(text, newCursorPosition)
    flushCommitted()
    true
  }

  private fun deleteFromTerminal(beforeLength: Int, afterLength: Int): Boolean {
    if (beforeLength < 0 || afterLength < 0) return false
    repeat(beforeLength) { emitKey("Backspace") }
    repeat(afterLength) { emitKey("Delete") }
    return true
  }

  override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean = edit {
    if (pending.isNotEmpty()) super.deleteSurroundingText(beforeLength, afterLength)
    else deleteFromTerminal(beforeLength, afterLength)
  }

  override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean = edit {
    if (pending.isNotEmpty()) super.deleteSurroundingTextInCodePoints(beforeLength, afterLength)
    else deleteFromTerminal(beforeLength, afterLength)
  }

  override fun closeConnection() {
    closed = true
    clearPending()
    // Base calls finishComposingText; closed prevents it from emitting cancelled input.
    super.closeConnection()
  }

  override fun sendKeyEvent(event: KeyEvent): Boolean {
    if (closed) return false
    if (event.action != KeyEvent.ACTION_DOWN) return true
    val name = when (event.keyCode) {
      KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "Enter"
      KeyEvent.KEYCODE_DEL -> "Backspace"
      KeyEvent.KEYCODE_FORWARD_DEL -> "Delete"
      KeyEvent.KEYCODE_DPAD_LEFT -> "Left"
      KeyEvent.KEYCODE_DPAD_RIGHT -> "Right"
      KeyEvent.KEYCODE_DPAD_UP -> "Up"
      KeyEvent.KEYCODE_DPAD_DOWN -> "Down"
      KeyEvent.KEYCODE_MOVE_HOME -> "Home"
      KeyEvent.KEYCODE_MOVE_END -> "End"
      KeyEvent.KEYCODE_TAB -> "Tab"
      KeyEvent.KEYCODE_ESCAPE -> "Esc"
      KeyEvent.KEYCODE_PAGE_UP -> "PgUp"
      KeyEvent.KEYCODE_PAGE_DOWN -> "PgDn"
      else -> null
    }
    if (name != null) {
      if (pending.isNotEmpty() && (name == "Backspace" || name == "Delete")) {
        // Hardware-style deletion during preedit edits only the local buffer, by code point.
        return edit {
          val start = minOf(Selection.getSelectionStart(pending), Selection.getSelectionEnd(pending))
          val end = maxOf(Selection.getSelectionStart(pending), Selection.getSelectionEnd(pending))
          val from = if (start == end && name == "Backspace" && start > 0)
            Character.offsetByCodePoints(pending, start, -1) else start
          val to = if (start == end && name == "Delete" && end < pending.length)
            Character.offsetByCodePoints(pending, end, 1) else end
          pending.delete(from, to)
          Selection.setSelection(pending, from)
          true
        }
      }
      finishComposingText()
      emitKey(name)
      return true
    }
    // Physical/bluetooth keyboard producing a printable char (soft-keys arrive via commitText).
    val ch = event.unicodeChar
    if (ch != 0 && Character.isValidCodePoint(ch)) {
      finishComposingText()
      emitText(String(Character.toChars(ch)))
      return true
    }
    return true
  }
}
