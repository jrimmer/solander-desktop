mod server_config;

use server_config::ConfigStore;
use std::sync::Arc;
use tauri::Manager;

/// Get the configured server URL.
#[tauri::command]
fn get_server_url(store: tauri::State<'_, Arc<ConfigStore>>) -> Option<String> {
    store.get_server_url()
}

/// Set the configured server URL.
#[tauri::command]
fn set_server_url(store: tauri::State<'_, Arc<ConfigStore>>, url: String) {
    store.set_server_url(url);
}

/// Clear the configured server URL.
#[tauri::command]
fn clear_server_url(store: tauri::State<'_, Arc<ConfigStore>>) {
    store.clear_server_url();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance MUST be registered first on Windows/Linux so deep-link
    // argv from a second process is forwarded to the running instance.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Deep-link event is already triggered by the plugin;
            // argv carries the URL on Windows/Linux.
            println!("[solander] second-instance argv: {argv:?}");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            let store = Arc::new(ConfigStore::new(app_data_dir));
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            set_server_url,
            clear_server_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Solander");
}