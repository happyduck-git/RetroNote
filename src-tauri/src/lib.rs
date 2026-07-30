#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(all(desktop, not(target_os = "macos")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            reveal_main(app);
        }));
    }

    let app = builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // 자동 업데이트: GitHub Releases 의 latest.json 을 폴링해 새 버전 감지.
        // 설치 후 재시작(relaunch)은 process 플러그인이 담당.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            use tauri::Manager;
            // Windows: decorations:false 창에도 DWM 그림자/테두리가 남아
            // 투명 배경 위로 사각형 프레임이 보인다. Windows 에서만 끈다.
            // macOS 는 호출하지 않아 콘텐츠를 감싸는 기존 그림자를 유지한다.
            #[cfg(windows)]
            {
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.set_shadow(false);
                }
            }
            // 펫 창(pet)은 스프라이트 외엔 전부 투명이라, macOS/Windows 양쪽 모두
            // 창 그림자를 끈다. 켜 두면 보이지 않는 창 사각형을 감싸는 그림자 박스가 뜬다.
            if let Some(pet) = _app.get_webview_window("pet") {
                let _ = pet.set_shadow(false);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::Manager;
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if pet_is_visible(window.app_handle()) {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            reveal_main(_app_handle);
        }
    });
}

fn reveal_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn pet_is_visible(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.get_webview_window("pet")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}
