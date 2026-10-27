//! Native terminal soft-keyboard control (Android). Drives the `TerminalKeyboard` overlay that
//! owns the IME for the xterm.js terminal — see `TerminalKeyboard.kt` and issue #34. No-op on
//! desktop, where the OS keyboard already works.

/// Calls a static `(Z)V` method on `TerminalKeyboard`; warns instead of failing the command.
fn call_bool(method: &str, value: bool) {
    #[cfg(target_os = "android")]
    crate::android_ctx::call_static_bool("com.voltius.app.TerminalKeyboard", method, value);
    #[cfg(not(target_os = "android"))]
    let _ = (method, value);
}

#[tauri::command]
pub fn terminal_show_keyboard(volume_ctrl: bool) {
    call_bool("show", volume_ctrl);
}

#[tauri::command]
pub fn terminal_hide_keyboard(focus_web_view: Option<bool>) {
    call_bool("hide", focus_web_view.unwrap_or(false));
}

#[tauri::command]
pub fn terminal_keyboard_target(generation: u32) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let result = crate::android_ctx::with_env("terminal keyboard target", |env, _| {
            let cls = crate::android_ctx::load_class(env, "com.voltius.app.TerminalKeyboard")?;
            env.call_static_method(
                &cls,
                "setGeneration",
                "(J)V",
                &[jni::objects::JValue::Long(generation as i64)],
            )?
            .v()
        });
        result.map_err(|_| "terminal keyboard target failed".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = generation;
        Ok(())
    }
}

#[tauri::command]
pub fn terminal_keyboard_snapshot() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let json = crate::android_ctx::with_env("terminal keyboard snapshot", |env, _| {
            let cls = crate::android_ctx::load_class(env, "com.voltius.app.TerminalKeyboard")?;
            let result = env
                .call_static_method(&cls, "snapshot", "()Ljava/lang/String;", &[])?
                .l()?;
            let text: String = env.get_string(&jni::objects::JString::from(result))?.into();
            Ok(text)
        })?;
        serde_json::from_str(&json).map_err(|_| "invalid keyboard diagnostic state".into())
    }
    #[cfg(not(target_os = "android"))]
    Ok(serde_json::Value::Null)
}

#[tauri::command]
pub fn terminal_selection_touch_feed(on: bool) {
    call_bool("setSelectionTouchFeed", on);
}
