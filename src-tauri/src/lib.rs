// Weave 的 Rust 侧只做几件事：
//   1. 创建窗口（桌面端无边框，配置见 tauri.conf.json）
//   2. 挂载 http 插件 —— 前端用它直连局域网 Emby，不受浏览器 CORS 限制
//   3. Windows 任务栏缩略图按钮（thumbbar.rs）
//   4. 桌面端挂载 libmpv 插件（HDR / 杜比视界）；安卓端 mpv 由 Kotlin 桥（MpvBridge）提供
mod thumbbar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_http::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_libmpv::init()).setup(|app| {
        // 明确设置窗口 / 任务栏图标（不依赖默认值，避免任务栏显示旧图标或默认图标）
        use tauri::Manager;
        if let Some(w) = app.get_webview_window("main") {
            if let Ok(img) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
                let _ = w.set_icon(img);
            }
        }
        Ok(())
    });

    builder
        .invoke_handler(tauri::generate_handler![thumbbar::thumb_init, thumbbar::thumb_playing])
        .run(tauri::generate_context!())
        .expect("启动 Weave 失败");
}
