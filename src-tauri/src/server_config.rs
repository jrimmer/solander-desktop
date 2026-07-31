use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// Persisted Solander configuration — the user's configured Chatto server URL.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SolanderConfig {
    pub server_url: Option<String>,
}

/// Thread-safe config store with in-memory deep-link callback storage.
pub struct ConfigStore {
    inner: Mutex<SolanderConfig>,
    path: PathBuf,
    pending_callback: Mutex<Option<String>>,
}

impl ConfigStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let path = app_data_dir.join("solander-config.json");
        let inner = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            SolanderConfig::default()
        };

        Self {
            inner: Mutex::new(inner),
            path,
            pending_callback: Mutex::new(None),
        }
    }

    pub fn get_server_url(&self) -> Option<String> {
        self.inner.lock().unwrap().server_url.clone()
    }

    pub fn set_server_url(&self, url: String) {
        let mut inner = self.inner.lock().unwrap();
        inner.server_url = Some(url);
        self.save(&inner);
    }

    pub fn clear_server_url(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.server_url = None;
        self.save(&inner);
    }

    fn save(&self, config: &SolanderConfig) {
        if let Ok(json) = serde_json::to_string_pretty(config) {
            let _ = std::fs::write(&self.path, json);
        }
    }

    /// Store a pending OAuth callback URL (from solander:// deep-link).
    pub fn set_pending_callback(&self, url: String) {
        *self.pending_callback.lock().unwrap() = Some(url);
    }

    /// Take and clear the pending OAuth callback URL.
    pub fn take_pending_callback(&self) -> Option<String> {
        self.pending_callback.lock().unwrap().take()
    }
}