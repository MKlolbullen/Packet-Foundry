//! Persists `LlmSettings` (provider, API key, model, base URL) to a JSON file in Tauri's
//! per-app config directory. Not encrypted at rest — that's a known limitation, not an
//! oversight; an OS-keychain-backed store would be the natural upgrade if this app ever ships
//! to less trusted machines.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use super::{LlmError, LlmSettings};

const SETTINGS_FILE: &str = "llm_settings.json";

fn settings_path(app: &AppHandle) -> Result<PathBuf, LlmError> {
    let dir = app.path().app_config_dir().map_err(|e| LlmError::Io(e.to_string()))?;
    fs::create_dir_all(&dir).map_err(|e| LlmError::Io(e.to_string()))?;
    Ok(dir.join(SETTINGS_FILE))
}

pub fn load(app: &AppHandle) -> Result<LlmSettings, LlmError> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(LlmSettings::default());
    }
    let text = fs::read_to_string(&path).map_err(|e| LlmError::Io(e.to_string()))?;
    serde_json::from_str(&text).map_err(|e| LlmError::Io(e.to_string()))
}

pub fn save(app: &AppHandle, settings: &LlmSettings) -> Result<(), LlmError> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| LlmError::Io(e.to_string()))?;
    fs::write(&path, text).map_err(|e| LlmError::Io(e.to_string()))
}
