package com.voltius.app

import android.content.Context
import android.net.Uri

/** Explicit user export through SAF. No broad storage permission or automatic upload. */
object TerminalDiagnostics {
  private var pending: String? = null
  @JvmStatic external fun nativeExported(result: Int)
  @JvmStatic @Synchronized fun exportReport(json: String): Boolean {
    val activity = MainActivity.instance ?: return false
    if (pending != null || json.toByteArray(Charsets.UTF_8).size > 1024 * 1024) return false
    pending = json
    activity.launchDiagnosticExport()
    return true
  }
  fun finish(context: Context, uri: Uri?) {
    val content = synchronized(this) { val value = pending; pending = null; value } ?: return
    if (uri == null) { nativeExported(0); return }
    Thread {
      val ok = try {
        context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(content.toByteArray(Charsets.UTF_8)) } != null
      } catch (_: Exception) { false }
      nativeExported(if (ok) 1 else -1)
    }.start()
  }
  fun cancel() {
    val existed = synchronized(this) { val value = pending != null; pending = null; value }
    if (existed) nativeExported(0)
  }
}
