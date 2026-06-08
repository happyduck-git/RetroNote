#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|_app| {
            // Windows: decorations:false 창에도 DWM 그림자/테두리가 남아
            // 투명 배경 위로 사각형 프레임이 보인다. Windows 에서만 끈다.
            // macOS 는 호출하지 않아 콘텐츠를 감싸는 기존 그림자를 유지한다.
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.set_shadow(false);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
