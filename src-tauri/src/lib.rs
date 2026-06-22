#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // 자동 업데이트: GitHub Releases 의 latest.json 을 폴링해 새 버전 감지.
        // 설치 후 재시작(relaunch)은 process 플러그인이 담당.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
