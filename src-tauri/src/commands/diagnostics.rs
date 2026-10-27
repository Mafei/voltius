use log::LevelFilter;
use serde_json::json;
use std::fs;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use voltius_diagnostics::{write_report_zip, ReportEntry};

#[tauri::command]
pub fn terminal_diagnostic_snapshot(
    ids: Vec<String>,
) -> Result<Vec<crate::terminal_diagnostics::Counts>, String> {
    if ids.len() > 128 || ids.iter().any(|s| s.len() > 128) {
        return Err("invalid diagnostic snapshot request".into());
    }
    Ok(crate::terminal_diagnostics::counters().snapshot(&ids))
}

#[cfg(target_os = "android")]
mod terminal_export {
    use jni::objects::{JClass, JObject, JValue};
    use std::sync::Mutex;
    use tokio::sync::oneshot;
    static PENDING: Mutex<Option<oneshot::Sender<i32>>> = Mutex::new(None);
    pub async fn save(json: String) -> Result<bool, String> {
        if json.len() > 1024 * 1024 {
            return Err("diagnostic report too large".into());
        }
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = PENDING
                .lock()
                .map_err(|_| "diagnostic export unavailable")?;
            if pending.is_some() {
                return Err("diagnostic export already open".into());
            }
            *pending = Some(tx);
        }
        let started = crate::android_ctx::with_env("terminal diagnostic export", |env, _| {
            let cls = crate::android_ctx::load_class(env, "com.voltius.app.TerminalDiagnostics")?;
            let content = JObject::from(env.new_string(json)?);
            env.call_static_method(
                &cls,
                "exportReport",
                "(Ljava/lang/String;)Z",
                &[JValue::Object(&content)],
            )?
            .z()
        });
        if !matches!(started, Ok(true)) {
            PENDING
                .lock()
                .map_err(|_| "diagnostic export unavailable")?
                .take();
            return Err("diagnostic export could not open".into());
        }
        match rx.await.map_err(|_| "diagnostic export interrupted")? {
            1 => Ok(true),
            0 => Ok(false),
            _ => Err("diagnostic file write failed".into()),
        }
    }
    #[no_mangle]
    pub extern "system" fn Java_com_voltius_app_TerminalDiagnostics_nativeExported(
        _env: jni::JNIEnv,
        _class: JClass,
        result: jni::sys::jint,
    ) {
        if let Ok(mut pending) = PENDING.lock() {
            if let Some(tx) = pending.take() {
                let _ = tx.send(result);
            }
        }
    }
}

#[tauri::command]
pub async fn terminal_diagnostic_export_android(json: String) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    return terminal_export::save(json).await;
    #[cfg(not(target_os = "android"))]
    {
        let _ = json;
        Err("Android export is unavailable on this platform".into())
    }
}

/// Raise/lower the process log level for the current session. Verbose is never
/// persisted — startup always re-establishes `Info` (see lib.rs setup).
#[tauri::command]
pub fn set_verbose_logging(enabled: bool) {
    log::set_max_level(if enabled {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    });
}

const README_TEXT: &str = "\
Voltius bug report
==================

Included:
  - App logs (what Voltius was doing, with sensitive values removed)
  - App version, operating system, and active plugins

NOT included:
  - Passwords, vault contents, or private keys
  - Terminal output or anything you typed

This report was saved on your computer. Nothing is sent automatically.
Send this file to the Voltius developer at contact@voltius.app or on GitHub.
";

#[tauri::command]
pub fn create_bug_report(app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("no log dir: {e}"))?;

    let mut warnings: Vec<String> = Vec::new();
    let mut entries: Vec<ReportEntry> = Vec::new();

    // Log files (voltius.log + a possible rotated sibling). Best-effort.
    if let Ok(read) = fs::read_dir(&log_dir) {
        for dirent in read.flatten() {
            let path = dirent.path();
            let is_log = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("voltius") && n.contains(".log"))
                .unwrap_or(false);
            if is_log {
                match fs::read(&path) {
                    Ok(bytes) => entries.push(ReportEntry {
                        name: path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("voltius.log")
                            .to_string(),
                        bytes,
                    }),
                    Err(e) => warnings.push(format!("read {}: {e}", path.display())),
                }
            }
        }
    } else {
        warnings.push("could not list log dir".into());
    }

    // system.json — best-effort collectors; failures recorded inline.
    let version = app.package_info().version.to_string();
    let sysinfo = crate::commands::sysinfo::get_system_info();
    let plugins: serde_json::Value = match app.path().app_config_dir() {
        Ok(dir) => match fs::read_dir(dir.join("plugins")) {
            Ok(read) => json!(read
                .flatten()
                .filter_map(|e| e.file_name().into_string().ok())
                .collect::<Vec<_>>()),
            Err(_) => json!([]),
        },
        Err(e) => {
            warnings.push(format!("plugins: {e}"));
            json!([])
        }
    };
    let webview_version = match tauri::webview_version() {
        Ok(v) => json!(v),
        Err(e) => {
            warnings.push(format!("webview_version: {e}"));
            serde_json::Value::Null
        }
    };
    let system = json!({
        "app_version": version,
        "system": sysinfo,
        "plugins": plugins,
        "webview_version": webview_version,
        "generated_at": chrono::Local::now().to_rfc3339(),
        "warnings": warnings,
    });
    entries.push(ReportEntry {
        name: "system.json".into(),
        bytes: serde_json::to_vec_pretty(&system).unwrap_or_else(|_| b"{}".to_vec()),
    });

    entries.push(ReportEntry {
        name: "README.txt".into(),
        bytes: README_TEXT.as_bytes().to_vec(),
    });

    let stamp = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
    let out_path = log_dir.join(format!("voltius-report-{stamp}.zip"));
    let file = fs::File::create(&out_path).map_err(|e| format!("create zip: {e}"))?;
    write_report_zip(&entries, file).map_err(|e| format!("write zip: {e}"))?;

    // Reveal in the file manager (best-effort; not fatal if it fails).
    let _ = app.opener().reveal_item_in_dir(&out_path);

    Ok(out_path.to_string_lossy().into_owned())
}
