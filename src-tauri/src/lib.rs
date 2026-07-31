mod server_config;

use server_config::ConfigStore;
use std::sync::Arc;
use tauri::{Listener, Manager};

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

/// Take and clear the pending OAuth callback URL (from solander:// deep-link).
#[tauri::command]
fn take_pending_callback(store: tauri::State<'_, Arc<ConfigStore>>) -> Option<String> {
    store.take_pending_callback()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance MUST be registered first on Windows/Linux so deep-link
    // argv from a second process is forwarded to the running instance.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Deep-link event is already triggered by the plugin;
            // argv carries the URL on Windows/Linux.
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
            let app_data_dir = match app.handle().path().app_data_dir() {
                Ok(dir) => dir,
                Err(e) => {
                    eprintln!("[solander] failed to resolve app data dir: {e}");
                    return Err(Box::new(e));
                }
            };
            if let Err(e) = std::fs::create_dir_all(&app_data_dir) {
                eprintln!("[solander] failed to create app data dir: {e}");
            }
            let store = Arc::new(ConfigStore::new(app_data_dir));
            app.manage(store.clone());

            // Listen for deep-link events. When a solander://callback URL
            // arrives (the OAuth provider redirects back after sign-in), store
            // it so the webview can retrieve it via take_pending_callback().
            let store_for_deep_link = store.clone();
            app.listen("deep-link://new-url", move |event| {
                if let Ok(urls) =
                    serde_json::from_str::<Vec<String>>(event.payload())
                {
                    if let Some(url) = urls.first() {
                        eprintln!("[solander] deep-link: {url}");
                        if url.starts_with("solander://callback") {
                            store_for_deep_link.set_pending_callback(url.clone());
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            set_server_url,
            clear_server_url,
            take_pending_callback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Solander");
}