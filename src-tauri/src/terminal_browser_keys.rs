//! Per-WebView browser accelerators only. No OS hook or global shortcut registration.

#[tauri::command]
pub async fn terminal_browser_keys(
    app: tauri::AppHandle,
    terminal_focused: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows_core::Interface;

        let window = app
            .get_webview_window("main")
            .ok_or("main webview unavailable")?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| {
                // The callback runs on the webview's owning UI thread. WebView2 v3
                // settings disable browser-only Find/Reload/Print/Zoom accelerators;
                // normal text editing and DOM keyboard events remain enabled.
                let result = unsafe {
                    (|| {
                        let settings = webview.controller().CoreWebView2()?.Settings()?;
                        settings
                            .cast::<ICoreWebView2Settings3>()?
                            .SetAreBrowserAcceleratorKeysEnabled(!terminal_focused)
                    })()
                };
                let _ = tx.send(result.map_err(|error| error.to_string()));
            })
            .map_err(|error| error.to_string())?;
        rx.await.map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, terminal_focused);
        Ok(())
    }
}
