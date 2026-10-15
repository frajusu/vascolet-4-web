//! Guardado en GitHub Pages = localStorage (gratis, sin backend).
//! Misma API en nativo (archivo) y wasm (localStorage).

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SaveData {
    pub level: u32,
    pub lives: i32,
    pub coins: u32,
    pub unlocked: u32,
    pub x: f32,
    pub y: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub volume: f32,
    pub lang: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { volume: 0.8, lang: "es".into() }
    }
}

const KEY: &str = "vascolet-web-save-v1";
const SETTINGS_KEY: &str = "vascolet-web-settings-v1";

pub fn write_checkpoint(data: &SaveData) {
    #[cfg(target_arch = "wasm32")]
    {
        let _ = gloo_storage::LocalStorage::set(KEY, data);
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = std::fs::write(
            "vascolet-save.json",
            serde_json::to_string(data).unwrap_or_default(),
        );
    }
}

pub fn read_checkpoint() -> Option<SaveData> {
    #[cfg(target_arch = "wasm32")]
    {
        gloo_storage::LocalStorage::get::<SaveData>(KEY).ok()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::fs::read_to_string("vascolet-save.json")
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }
}

pub fn write_settings(s: &Settings) {
    #[cfg(target_arch = "wasm32")]
    {
        let _ = gloo_storage::LocalStorage::set(SETTINGS_KEY, s);
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = std::fs::write(
            "vascolet-settings.json",
            serde_json::to_string(s).unwrap_or_default(),
        );
    }
}

pub fn read_settings() -> Settings {
    #[cfg(target_arch = "wasm32")]
    {
        gloo_storage::LocalStorage::get::<Settings>(SETTINGS_KEY).unwrap_or_default()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::fs::read_to_string("vascolet-settings.json")
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
}
